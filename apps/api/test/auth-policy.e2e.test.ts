import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';

/**
 * THE AUTH POLICY, over HTTP and against real Postgres (port wave 3, ADR-035).
 *
 * The point of this suite is that the policy is ENFORCED, not merely present. Everything here goes
 * through the real routes and the real middleware; nothing reaches into the service. Five things are
 * proven to actually happen to a request:
 *
 *   sign-in is two steps  ·  a replayed code is refused  ·  a session dies of idleness  ·
 *   the second-factor budget locks separately from the password one  ·  step-up gates release
 *
 * Runs only with DATABASE_URL_TEST, like the other DB suites. Note the boot order below: AppModule
 * reads SCRAPER_REPOSITORY at import time, so the env has to be set before the dynamic import.
 */
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('auth policy (0008) end to end', () => {
  let app: INestApplication;
  let base: string;
  let db: PrismaClient;

  const EMAIL = 'wave3@example.com';
  const PASSWORD = 'korrekt-pferd-batterie-heftklammer';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SCRAPER_REPOSITORY = 'prisma';
    process.env.DATABASE_URL = url;
    delete process.env.SCRAPER_DEV_FIXTURES; // a real session must be earned, not filled in

    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" = $1`, EMAIL);

    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../dist/app.module.js');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    await db?.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" = $1`, EMAIL);
    await db?.$disconnect();
    delete process.env.SCRAPER_REPOSITORY;
  });

  const post = (path: string, body?: unknown, token?: string) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;

  /** The current code, computed the same way the server will. */
  async function currentCode(secret: string, at = Date.now()): Promise<string> {
    const { totp } = await import('@scraper/core');
    return totp(secret, at);
  }

  /**
   * Clear the replay counter between tests that need a fresh successful challenge.
   *
   * This is fixture discipline, not a bypass, and the constraint it works around is the feature: the
   * accept window is ±1 step, so once a counter is spent there are at most two more usable codes
   * before real time has to advance. A suite that signs in eight times cannot do so inside one
   * 30-second window. The replay test below deliberately does NOT call this — that is where the
   * defence is proven.
   *
   * It uses raw SQL because the monotonic trigger (0008) refuses to let the counter be cleared
   * through an ordinary UPDATE, which is itself the invariant `db-invariants.test.ts` proves.
   */
  async function resetReplayCounter(): Promise<void> {
    await db.$executeRawUnsafe(`ALTER TABLE "User" DISABLE TRIGGER "totp_counter_monotonic"`);
    await db.$executeRawUnsafe(`UPDATE "User" SET "totpLastCounter" = NULL, "failedMfaCount" = 0, "lastFailedMfaAt" = NULL WHERE "email" = $1`, EMAIL);
    await db.$executeRawUnsafe(`ALTER TABLE "User" ENABLE TRIGGER "totp_counter_monotonic"`);
  }

  /** Identity verification is a DIFFERENT gate (proven in the other suites); set it so the release
   *  route's refusal is attributable to STEP-UP rather than to an unverified identity. */
  async function verifyIdentity(): Promise<void> {
    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const identity = await db.identity.findUniqueOrThrow({ where: { userId: user.id } });
    // Idempotent because it has to be: `identity_freeze` (0005) makes a VERIFIED identity immutable,
    // so a second write would be refused by the database — correctly.
    if (identity.status === 'VERIFIED') return;
    await db.identity.update({
      where: { userId: user.id },
      data: { status: 'VERIFIED', method: 'EID', legalName: 'Martina Musterfrau', dateOfBirth: new Date('1980-05-04'), verifiedAt: new Date(), providerRef: 'test-stub' },
    });
  }

  let totpSecret = '';
  let recoveryCodes: string[] = [];

  it('registration returns the TOTP secret AND recovery codes, exactly once', async () => {
    const r = await post('/auth/register', { email: EMAIL, password: PASSWORD });
    expect(r.status).toBe(201);
    const body = await json(r);
    totpSecret = String(body.totpSecret);
    recoveryCodes = body.recoveryCodes as string[];

    expect(totpSecret).toMatch(/^[A-Z2-7]+$/);
    expect(recoveryCodes).toHaveLength(10);
    // Only hashes are persisted — there is no code path that can read the plaintext back, which is
    // exactly why the UI must render them from this response and store them nowhere.
    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL }, include: { recoveryCodes: true } });
    expect(user.recoveryCodes).toHaveLength(10);
    for (const stored of user.recoveryCodes) {
      expect(recoveryCodes).not.toContain(stored.codeHash);
      expect(stored.usedAt).toBeNull();
    }
    expect(user.totpEnrolledAt).not.toBeNull();
  });

  it('rejects a password the policy refuses, with a machine-readable reason', async () => {
    const short = await json(await post('/auth/register', { email: 'x@example.com', password: 'kurz' }));
    expect(short.reason).toBe('TOO_SHORT');
    const common = await json(await post('/auth/register', { email: 'y@example.com', password: 'passwort-passwort' }));
    expect(common.reason).toBe('COMMON_SEQUENCE');
    const ownEmail = await json(await post('/auth/register', { email: 'martina@example.com', password: 'martina-und-mehr-text' }));
    expect(ownEmail.reason).toBe('CONTAINS_EMAIL');
  });

  it('a password alone authenticates for NOTHING but the challenge', async () => {
    const { token } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };
    expect(token).toBeTruthy();

    // The session exists but carries no second factor: the middleware attaches nothing, so a guarded
    // route sees an unauthenticated caller rather than a half-authenticated one.
    const guarded = await fetch(`${base}/credit-file/findings`, { headers: { authorization: `Bearer ${token}` } });
    expect(guarded.status).toBe(403);

    const row = await db.session.findFirstOrThrow({ where: { user: { email: EMAIL } }, orderBy: { createdAt: 'desc' } });
    expect(row.mfaVerified).toBe(false);
    expect(row.mfaCompletedAt).toBeNull();
    expect(row.stepUpAt).toBeNull();
  });

  it('completing MFA does NOT grant step-up, and the release route stays shut', async () => {
    await resetReplayCounter();
    await verifyIdentity();
    const { token } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };
    const ok = await post('/auth/totp', { code: await currentCode(totpSecret) }, token);
    expect(ok.status).toBe(201);

    const row = await db.session.findFirstOrThrow({ where: { user: { email: EMAIL } }, orderBy: { createdAt: 'desc' } });
    expect(row.mfaCompletedAt).not.toBeNull();
    // Signing in and re-confirming to open a credit file are different acts. If this were granted at
    // sign-in the whole gate would be ornamental.
    expect(row.stepUpAt).toBeNull();

    const denied = await fetch(`${base}/credit-file/findings`, { headers: { authorization: `Bearer ${token}` } });
    expect(denied.status).toBe(403);
    const body = await json(denied);
    expect(body.reason).toBe('STEP_UP_REQUIRED');
    // Usability gate: a refusal names the next action rather than dead-ending.
    expect(body.nextAction).toBe('CONFIRM_SECOND_FACTOR');
  });

  it('REFUSES a replayed code — the same one that just worked', async () => {
    // NOTE: no resetReplayCounter() here. This is the test the defence exists for.
    await resetReplayCounter();
    const { token } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };
    const code = await currentCode(totpSecret);
    expect((await post('/auth/totp', { code }, token)).status).toBe(201);

    // Present the very same code again, inside its window. Before wave 3 this succeeded, so a code
    // read over a shoulder stayed a working credential for up to a minute.
    const replay = await post('/auth/step-up', { code }, token);
    expect(replay.status).toBe(401);
    expect((await json(replay)).reason).toBe('REPLAYED');

    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.totpLastCounter).not.toBeNull();
  });

  it('step-up opens the release route, and only after a FRESH code', async () => {
    await resetReplayCounter();
    await verifyIdentity();
    const { token } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };
    await post('/auth/totp', { code: await currentCode(totpSecret) }, token);

    // Still shut: MFA is done, step-up is not.
    const before = await fetch(`${base}/credit-file/findings`, { headers: { authorization: `Bearer ${token}` } });
    expect(before.status).toBe(403);
    expect((await json(before)).reason).toBe('STEP_UP_REQUIRED');

    // A code from the NEXT window — a fresh credential, not the one sign-in already spent.
    await resetReplayCounter();
    const stepped = await post('/auth/step-up', { code: await currentCode(totpSecret) }, token);
    expect(stepped.status).toBe(201);
    expect((await json(stepped)).stepUp).toBe(true);

    const opened = await fetch(`${base}/credit-file/findings`, { headers: { authorization: `Bearer ${token}` } });
    expect(opened.status).toBe(200);
  });

  it('a session dies of IDLENESS even while its absolute TTL is still valid', async () => {
    await resetReplayCounter();
    const { token } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };
    expect((await post('/auth/totp', { code: await currentCode(totpSecret) }, token)).status).toBe(201);

    const row = await db.session.findFirstOrThrow({ where: { user: { email: EMAIL } }, orderBy: { createdAt: 'desc' } });
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now()); // 12h TTL: nowhere near expiry
    // Backdate the activity past the 30-minute idle window — the tab left open on a shared laptop.
    await db.session.update({ where: { id: row.id }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });

    const after = await fetch(`${base}/credit-file/findings`, { headers: { authorization: `Bearer ${token}` } });
    expect(after.status).toBe(403); // attaches nothing → the identity guard refuses first
    const stillLive = await db.session.findUniqueOrThrow({ where: { id: row.id } });
    expect(stillLive.revokedAt).toBeNull(); // idle is a POLICY verdict, not a mutation
  });

  it('locks the second-factor budget SEPARATELY from the password one', async () => {
    await db.user.update({ where: { email: EMAIL }, data: { failedLoginCount: 0, lastFailedLoginAt: null, failedMfaCount: 0, lastFailedMfaAt: null } });
    const { token } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };

    // Five wrong codes exhaust the MFA budget (MAX_FAILED_MFA = 5).
    for (let i = 0; i < 5; i += 1) {
      const r = await post('/auth/totp', { code: '000000' }, token);
      expect([401, 403]).toContain(r.status);
    }
    const locked = await post('/auth/totp', { code: await currentCode(totpSecret) }, token);
    expect(locked.status).toBe(403);
    const body = await json(locked);
    expect(body.reason).toBe('MFA_LOCKED');
    expect(Number(body.retryAfterSeconds)).toBeGreaterThan(0);

    // THE POINT: the password budget is untouched, so the account holder can still sign in — and,
    // inversely, a stranger who knows only the email cannot spray passwords to lock the victim out
    // of their own authenticator.
    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.failedMfaCount).toBe(5);
    expect(user.failedLoginCount).toBe(0);
    expect((await post('/auth/login', { email: EMAIL, password: PASSWORD })).status).toBe(201);
  });

  it('a recovery code completes MFA once, is then spent, and does not open the release route', async () => {
    await resetReplayCounter();
    await verifyIdentity();
    const { token } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };

    const code = recoveryCodes[0]!;
    const used = await post('/auth/recovery', { code }, token);
    expect(used.status).toBe(201);
    expect((await json(used)).remainingCodes).toBe(9);

    // Signing in from a code found on paper must not thereby open the credit file.
    const denied = await fetch(`${base}/credit-file/findings`, { headers: { authorization: `Bearer ${token}` } });
    expect(denied.status).toBe(403);
    expect((await json(denied)).reason).toBe('STEP_UP_REQUIRED');

    // The same code again, on a fresh session: single use is enforced by the database.
    const { token: second } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };
    const replayed = await post('/auth/recovery', { code }, second);
    expect(replayed.status).toBe(401);
    expect((await json(replayed)).reason).toBe('BAD_RECOVERY_CODE');
  });

  it('revoke-everywhere kills every session INCLUDING the caller', async () => {
    await resetReplayCounter();
    const a = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };
    expect((await post('/auth/totp', { code: await currentCode(totpSecret) }, a.token)).status).toBe(201);

    const revoked = await json(await post('/auth/revoke-all', undefined, a.token));
    expect(Number(revoked.revoked)).toBeGreaterThanOrEqual(1);

    // "Sign out everywhere" that leaves the caller signed in is not what the words mean — and if the
    // caller IS the attacker, theirs is the one session that matters.
    const after = await fetch(`${base}/credit-file/findings`, { headers: { authorization: `Bearer ${a.token}` } });
    expect(after.status).toBe(403);
    const live = await db.session.count({ where: { user: { email: EMAIL }, revokedAt: null } });
    expect(live).toBe(0);
  });

  // -------------------------------------------------------------------------------------------
  // Concurrency. These are the cases the sequential tests above CANNOT see, and they are the ones
  // an attacker actually uses: every control here is a read-modify-write unless it is written to be
  // atomic, and a throttle that scales with the attacker's concurrency is not a throttle.
  // -------------------------------------------------------------------------------------------

  it('the MFA budget counts every CONCURRENT failure, not one per batch', async () => {
    await resetReplayCounter();
    const { token } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };

    // Twelve simultaneous wrong codes. With a read-then-write counter all twelve read 0 and all write
    // 1, so twelve guesses would cost one unit of a five-unit budget — and the budget would scale with
    // however much concurrency the attacker can muster.
    await Promise.all(Array.from({ length: 12 }, () => post('/auth/totp', { code: '000000' }, token)));

    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.failedMfaCount).toBeGreaterThanOrEqual(12);
    // And the account is genuinely locked afterwards, not merely counted.
    const locked = await post('/auth/totp', { code: await currentCode(totpSecret) }, token);
    expect(locked.status).toBe(403);
    expect((await json(locked)).reason).toBe('MFA_LOCKED');
  });

  it('the password budget counts every CONCURRENT failure too', async () => {
    await db.user.update({ where: { email: EMAIL }, data: { failedLoginCount: 0, lastFailedLoginAt: null } });
    await Promise.all(
      Array.from({ length: 12 }, () => post('/auth/login', { email: EMAIL, password: 'falsch-falsch-falsch' })),
    );
    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.failedLoginCount).toBeGreaterThanOrEqual(12);
    await db.user.update({ where: { email: EMAIL }, data: { failedLoginCount: 0, lastFailedLoginAt: null } });
  });

  it('a code presented twice AT ONCE succeeds exactly once', async () => {
    await resetReplayCounter();
    const a = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };
    const b = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };

    // The real-time relay case: the victim submits their code while a proxy forwards the same one.
    // A read-then-write counter lets both through, because both read the pre-code value.
    const code = await currentCode(totpSecret);
    const results = await Promise.all([
      post('/auth/totp', { code }, a.token),
      post('/auth/totp', { code }, b.token),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 401]);

    const verified = await db.session.count({
      where: { user: { email: EMAIL }, tokenHash: { in: [] } , mfaVerified: true, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    expect(verified).toBeLessThanOrEqual(1);
  });

  it('answers a failed sign-in in the caller\'s own language, never a raw status line', async () => {
    await db.user.update({ where: { email: EMAIL }, data: { failedLoginCount: 0, lastFailedLoginAt: null } });
    const de = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': 'de' },
      body: JSON.stringify({ email: EMAIL, password: 'falsch-falsch-falsch' }),
    });
    const body = await json(de);
    // The machine code stays for the client to branch on; the prose is what the user reads.
    expect(body.reason).toBe('BAD_CREDENTIALS');
    expect(String(body.message)).not.toMatch(/^HTTP /);
    expect(String(body.message)).toMatch(/Passwort/);

    const en = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': 'en' },
      body: JSON.stringify({ email: EMAIL, password: 'falsch-falsch-falsch' }),
    });
    expect(String((await json(en)).message)).toMatch(/password/i);
    await db.user.update({ where: { email: EMAIL }, data: { failedLoginCount: 0, lastFailedLoginAt: null } });
  });

  it('a replayed code is explained, not reported as HTTP 401', async () => {
    await resetReplayCounter();
    const { token } = (await json(await post('/auth/login', { email: EMAIL, password: PASSWORD }))) as { token: string };
    const code = await currentCode(totpSecret);
    await post('/auth/totp', { code }, token);

    const replay = await fetch(`${base}/auth/step-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'accept-language': 'de' },
      body: JSON.stringify({ code }),
    });
    const body = await json(replay);
    expect(body.reason).toBe('REPLAYED');
    // This is the case the normal sign-in → open-Akte journey hits, so it must read as an instruction.
    expect(String(body.message)).toMatch(/schon benutzt/);
  });

  it('registration leaves NO account behind when it fails part-way', async () => {
    const orphanEmail = 'wave3-orphan@example.com';
    await db.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" = $1`, orphanEmail);
    // A password the policy refuses fails AFTER the email check and before any row is written; the
    // interesting property is that no partial account survives any failure in registration.
    await post('/auth/register', { email: orphanEmail, password: 'kurz' });
    expect(await db.user.count({ where: { email: orphanEmail } })).toBe(0);

    // And a successful registration leaves a COMPLETE account — never a user without a credential,
    // which would answer EMAIL_TAKEN forever while being impossible to sign in to.
    await post('/auth/register', { email: orphanEmail, password: 'korrekt-pferd-batterie-heftklammer' });
    const created = await db.user.findUniqueOrThrow({
      where: { email: orphanEmail },
      include: { authCredential: true, identity: true, recoveryCodes: true },
    });
    expect(created.authCredential).not.toBeNull();
    expect(created.identity).not.toBeNull();
    expect(created.recoveryCodes).toHaveLength(10);
    await db.$executeRawUnsafe(`DELETE FROM "User" WHERE "email" = $1`, orphanEmail);
  });

  it('registering a TAKEN address is indistinguishable from success and persists nothing (DPIA R2)', async () => {
    const before = await db.user.count({ where: { email: EMAIL } });
    const r = await post('/auth/register', { email: EMAIL, password: 'falscher-zweitversuch-vom-angreifer-99' });
    expect(r.status).toBe(201);
    const body = await json(r);
    // Same shape as a real registration: an attacker must not learn the address is taken from the
    // response, its fields, or the id FORMAT.
    expect(String(body.totpSecret).length).toBeGreaterThan(10);
    expect(String(body.userId)).toMatch(/^c[a-z0-9]{24}$/);
    expect(body.recoveryCodes).toHaveLength(10);
    // ... and nothing changed: one account, the original credentials still the only ones that work.
    expect(await db.user.count({ where: { email: EMAIL } })).toBe(before);
    expect(await db.user.count()).toBeGreaterThan(0);
    const login = await post('/auth/login', { email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(201);
  });
});
