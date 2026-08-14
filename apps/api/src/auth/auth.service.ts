import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
// Value import on purpose: a type-only import degrades the DI metadata to Function ("Function at
// index [0]"). This repo has been bitten by that twice.
import { PrismaClient } from '@prisma/client';
import {
  AesGcmEnvelopeCrypto,
  DevKekResolver,
  EnvKekResolver,
  KEY_PURPOSES,
  EnvelopeSecretCipher,
  LOGIN_THROTTLE,
  MFA_THROTTLE,
  PasswordPolicyError,
  RECOVERY_CODE_COUNT,
  STEP_UP_TTL_MINUTES,
  assertPasswordAcceptable,
  evaluateSession,
  findMatchingHash,
  generateRecoveryCodes,
  isLockedOut,
  lockoutRemainingSeconds,
  sessionExpiryFrom,
  sha256Hex,
  type ThrottleState,
  type UserKeyResolver,
} from '@scraper/core';
import { randomBytes } from 'node:crypto';
import { generateTotpSecret, hashPassword, hashToken, newSessionToken, totpProvisioningUri, verifyPassword, verifyTotp } from './crypto.js';

/**
 * Real auth (docs/01 P0, docs/06 C2): email + password + TOTP MFA, sessions as hashed bearer tokens.
 * Prisma-backed — auth exists only in DB mode (SCRAPER_REPOSITORY=prisma); the in-memory alpha keeps
 * using the dev-fixture identity instead. Registration creates the account AND an UNVERIFIED
 * Identity row: authentication never touches the identity-verification gate — a fresh account can
 * sign in and still cannot create a rights request until the ident provider marks it VERIFIED.
 *
 * The TOTP secret is envelope-encrypted at rest under the user's DEK (CLAUDE.md §4, port wave 1) —
 * a database dump does not hand over the second factor.
 *
 * Port wave 3 (ADR-035) replaced three things that were placeholders:
 *  - the in-memory attempt map became DURABLE per-account counters, with the password and
 *    second-factor budgets kept apart (see packages/core/src/auth/session.ts for why),
 *  - TOTP verification became replay-defended: the accepted counter is persisted and anything at or
 *    below it is refused, so a code read over a shoulder is not still valid for the rest of its
 *    window,
 *  - MFA is no longer a one-way boolean: sessions carry timestamps, so the idle timeout and step-up
 *    can be decided at all.
 *
 * All policy decisions live in `@scraper/core`; this class is the I/O around them.
 */
@Injectable()
export class AuthService {
  private readonly secrets: EnvelopeSecretCipher;

  constructor(private readonly db: PrismaClient) {
    // KEKs come from the environment in any deployed setting; the dev resolver derives a shared,
    // deliberately non-secret key and refuses to run under NODE_ENV=production.
    const keks = kekResolver();
    const keys: UserKeyResolver = {
      getUserKey: async (userId: string) => {
        const u = await this.db.user.findUnique({ where: { id: userId }, select: { wrappedDek: true, kekRef: true } });
        if (!u?.wrappedDek || !u.kekRef) throw new Error(`user ${userId} has no envelope key material`);
        return { wrappedDek: Buffer.from(u.wrappedDek), kekRef: u.kekRef };
      },
    };
    this.secrets = new EnvelopeSecretCipher(new AesGcmEnvelopeCrypto(keks), keys);
  }

  async register(
    email: string,
    password: string,
  ): Promise<{ userId: string; totpSecret: string; totpProvisioningUri: string; recoveryCodes: readonly string[] }> {
    const mail = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
      throw new BadRequestException({ error: 'INVALID_EMAIL', reason: 'INVALID_EMAIL' });
    }
    try {
      assertPasswordAcceptable(password, mail);
    } catch (e) {
      if (e instanceof PasswordPolicyError) throw new BadRequestException({ error: 'WEAK_PASSWORD', reason: e.code });
      throw e;
    }
    // DPIA R2: no enumeration oracle on ANY auth path. Login pays a decoy KDF for unknown emails;
    // register previously answered EMAIL_TAKEN — a clean account-existence oracle one route over
    // (audit M5). A taken address now gets a DECOY registration: same response shape, same crypto
    // cost, nothing persisted. The real account is untouched (its owner uses the standing
    // "schon ein Konto? → anmelden" path); the decoy TOTP secret is stored nowhere, so it can
    // never validate.
    const existing = await this.db.user.findUnique({ where: { email: mail } });
    if (existing) return this.decoyRegistration(mail, password);

    const totpSecret = generateTotpSecret();
    // The per-user DEK is provisioned WITH the user, before any credential exists — the 0004 trigger
    // refuses a credential row whose user has no key material, so the secret can never be unopenable.
    const crypto = new AesGcmEnvelopeCrypto(kekResolver());
    const kekRef = 'user';
    const { wrappedDek } = await crypto.generateWrappedDek(kekRef);
    // Generated here and returned ONCE. Only the hashes are persisted; there is no code path that
    // can read them back, which is the whole point — and why the UI must render them from this
    // return value and store them nowhere.
    const recovery = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    const passwordHash = await hashPassword(password);

    // ONE interactive transaction, user row included. Creating the user outside it leaves a failure
    // window in which the account exists with no credential: the address then answers EMAIL_TAKEN to
    // any retry and has nothing to sign in with, and there is no self-service route out of that.
    // Sealed with the key generated above, NOT via the userId-resolving cipher: inside the
    // transaction the user row is not yet visible to the outer client, so that resolver would fail to
    // find its own user. `EnvelopeSecretCipher` only ever uses the userId to LOOK UP this same
    // wrappedDek/kekRef pair (it is not bound into the ciphertext), so sealing with the material
    // directly produces exactly what `decrypt(userId, …)` will later open.
    const totpSecretEnc = await crypto.encrypt(wrappedDek, kekRef, Buffer.from(totpSecret, 'utf8'));

    let userId: string;
    try {
      userId = await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email: mail, wrappedDek, kekRef, totpEnrolledAt: new Date() } });
        await tx.authCredential.create({ data: { userId: user.id, passwordHash, totpSecretEnc } });
        // The identity record exists from minute one — UNVERIFIED, so every request route 403s until
        // the ident provider verifies. Auth and identity verification are deliberately separate gates.
        await tx.identity.create({ data: { userId: user.id, status: 'UNVERIFIED' } });
        await tx.recoveryCode.createMany({ data: recovery.hashes.map((codeHash) => ({ userId: user.id, codeHash })) });
        // The DOSSIER and EVIDENCE keys are minted here, in the SAME transaction as the user, for
        // the reason the comment above gives about the credential: a user who exists without a
        // dossier key has an identity row nothing can seal into, and the failure would surface much
        // later as an identity verification that cannot be saved. Minting is idempotent by the
        // (userId, purpose) unique index, so the concurrent-registration path below cannot produce a
        // second DOSSIER key and silently orphan whatever the first one sealed.
        // See packages/core/src/crypto/user-keys.ts for what each key protects and for how long.
        for (const purpose of KEY_PURPOSES) {
          const purposeKey = await crypto.generateWrappedDek(kekRef);
          await tx.userKey.create({ data: { userId: user.id, purpose, wrappedDek: purposeKey.wrappedDek, kekRef } });
        }
        return user.id;
      });
    } catch (e) {
      // Concurrent duplicate: the email unique closed the race the `existing` read missed. Same
      // neutral answer as the sequential path — a 500 here was both an oracle and a fault (W12).
      if ((e as { code?: string }).code === 'P2002') {
        return { userId: decoyUserId(), totpSecret, totpProvisioningUri: totpProvisioningUri(mail, totpSecret), recoveryCodes: recovery.codes };
      }
      throw e;
    }
    return { userId, totpSecret, totpProvisioningUri: totpProvisioningUri(mail, totpSecret), recoveryCodes: recovery.codes };
  }

  /** The decoy path pays the SAME crypto cost as a real registration — timing is the oracle too. */
  private async decoyRegistration(mail: string, password: string) {
    const totpSecret = generateTotpSecret();
    const crypto = new AesGcmEnvelopeCrypto(kekResolver());
    const { wrappedDek } = await crypto.generateWrappedDek('user');
    const recovery = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    await hashPassword(password);
    await crypto.encrypt(wrappedDek, 'user', Buffer.from(totpSecret, 'utf8'));
    return {
      userId: decoyUserId(),
      totpSecret,
      totpProvisioningUri: totpProvisioningUri(mail, totpSecret),
      recoveryCodes: recovery.codes,
    };
  }

  /** Step 1: password. Returns a session that is NOT yet MFA-verified — only /auth/totp upgrades it. */
  async login(email: string, password: string): Promise<{ token: string; mfaRequired: true }> {
    const mail = email.trim().toLowerCase();
    const now = new Date();
    const user = await this.db.user.findUnique({ where: { email: mail }, include: { authCredential: true } });

    // The lockout is checked against the ACCOUNT, before the password is even compared, so a
    // locked-out account cannot be used as a password oracle.
    if (user && isLockedOut(loginThrottle(user), LOGIN_THROTTLE, now)) {
      throw new ForbiddenException({
        error: 'RATE_LIMITED',
        reason: 'LOGIN_LOCKED',
        retryAfterSeconds: lockoutRemainingSeconds(loginThrottle(user), LOGIN_THROTTLE, now),
      });
    }
    // Always pay the KDF, even for an unknown email. Skipping it returns in microseconds instead of
    // ~100ms, which is a clean account-existence oracle for anyone with a stopwatch. The dummy hash
    // is a real scrypt verification against a fixed hash, so the work is genuinely equivalent.
    const ok = user?.authCredential
      ? await verifyPassword(password, user.authCredential.passwordHash)
      : (await verifyPassword(password, await this.decoyHash()), false);
    if (!ok) {
      // A miss on an unknown email records nothing — there is no row to record it against, and
      // creating one would turn the counter table into an email-existence oracle.
      if (user) await this.bumpLoginThrottle(user.id, 'FAILURE', now);
      throw new UnauthorizedException({ error: 'BAD_CREDENTIALS', reason: 'BAD_CREDENTIALS' });
    }
    await this.bumpLoginThrottle(user!.id, 'SUCCESS', now);

    const { token, tokenHash } = newSessionToken();
    await this.db.session.create({
      data: {
        tokenHash,
        userId: user!.id,
        mfaVerified: false,
        // NOT mfaCompletedAt — a password alone authenticates for nothing but the challenge.
        createdAt: now,
        lastSeenAt: now,
        expiresAt: sessionExpiryFrom(now),
      },
    });
    return { token, mfaRequired: true };
  }

  /**
   * Step 2: TOTP. Issues a NEW session token and revokes the one the password bought.
   *
   * THE ROTATION, and why it is not a nicety (audit L2). This used to upgrade the same bearer in
   * place: `UPDATE Session SET mfaVerified = true WHERE id = <the token the caller already holds>`.
   * So a token captured while it was still worthless — the window between `/auth/login` and
   * `/auth/totp`, which is where a token is most exposed because it has just been minted, logged,
   * proxied and put in a cookie for the first time — became a fully privileged session the moment the
   * VICTIM completed their own challenge. The attacker needed no code. They needed only to wait.
   *
   * Rotation closes it structurally: privilege is never attached to an identifier that existed before
   * the second factor was proven. What comes back is a different secret, and the old one is revoked
   * in the same transaction, so the captured token is worth exactly what it was worth when it was
   * taken — nothing.
   *
   * What is deliberately CARRIED OVER rather than refreshed: `createdAt` and `expiresAt`. Rotation
   * must not be a lifetime-extension primitive — otherwise a session could be kept alive forever by
   * re-confirming, and the absolute TTL would stop meaning anything.
   */
  async verifyTotpStep(token: string, code: string): Promise<{ mfaVerified: true; token: string }> {
    const now = new Date();
    const session = await this.loadSessionForChallenge(token, now);
    await this.consumeTotp(session.userId, code, now);
    const rotated = await this.rotateSession(session, now, {
      mfaVerified: true,
      mfaCompletedAt: now,
      // Note what is NOT set: stepUpAt. Completing the challenge at sign-in and re-confirming it to
      // open a credit file are different acts; treating the first as the second would make the gate
      // ornamental (docs/06 C2).
    });
    return { mfaVerified: true, token: rotated };
  }

  /**
   * Re-confirm the second factor to open high-sensitivity data (docs/06 C2).
   *
   * Requires an ALREADY MFA-verified session: step-up is a re-confirmation, never a substitute for
   * the sign-in challenge, and the DB refuses the other order anyway (session_stepup_requires_mfa).
   * The same replay defence applies — a captured code cannot be replayed into step-up either.
   */
  async stepUp(token: string, code: string): Promise<{ stepUp: true; expiresInSeconds: number; token: string }> {
    const now = new Date();
    const session = await this.db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    const verdict = evaluateSession(session ? toSessionState(session) : null, now);
    if (!verdict.ok) throw sessionRejection(verdict.reason);

    await this.consumeTotp(session!.userId, code, now);
    // Rotated for the same reason as the sign-in challenge (audit L2), and the stakes are higher
    // here: a step-up token opens the credit file. Any copy of the pre-step-up bearer — in a proxy
    // log, a browser extension, a shared machine's cookie jar — must not become a credit-file key
    // because the account holder later confirmed a code for their own reasons.
    const rotated = await this.rotateSession(
      { id: session!.id, userId: session!.userId, createdAt: session!.createdAt, expiresAt: session!.expiresAt },
      now,
      { mfaVerified: true, mfaCompletedAt: session!.mfaCompletedAt, stepUpAt: now },
    );
    return { stepUp: true, expiresInSeconds: STEP_UP_TTL_MINUTES * 60, token: rotated };
  }

  /**
   * Issue a new session token carrying `grants`, and revoke the old row — atomically.
   *
   * ATOMIC is the whole contract. Two rows both live for an instant would be a second usable
   * credential; neither row live would sign the user out mid-challenge, which is the failure mode
   * that makes people turn a security control off. One transaction gives the caller exactly one
   * working token at every observable moment.
   *
   * `createdAt` and `expiresAt` are inherited, never recomputed: rotation re-issues an identifier, it
   * does not restart the clock on the session's absolute lifetime.
   */
  private async rotateSession(
    old: { id: string; userId: string; createdAt: Date; expiresAt: Date },
    now: Date,
    grants: { mfaVerified: boolean; mfaCompletedAt: Date | null; stepUpAt?: Date },
  ): Promise<string> {
    const { token, tokenHash } = newSessionToken();
    await this.db.$transaction([
      this.db.session.update({ where: { id: old.id }, data: { revokedAt: now } }),
      this.db.session.create({
        data: {
          tokenHash,
          userId: old.userId,
          mfaVerified: grants.mfaVerified,
          mfaCompletedAt: grants.mfaCompletedAt,
          ...(grants.stepUpAt ? { stepUpAt: grants.stepUpAt } : {}),
          createdAt: old.createdAt,
          lastSeenAt: now,
          expiresAt: old.expiresAt,
        },
      }),
    ]);
    return token;
  }

  /**
   * Redeem a recovery code in place of the TOTP challenge.
   *
   * The code is spent by the database, not by this method: `recovery_code_single_use` refuses a
   * second redemption even under a concurrent double-submit. Redeeming completes MFA but deliberately
   * does NOT grant step-up — someone signing in from a code they found on paper should not thereby
   * open the credit file.
   */
  async redeemRecoveryCode(token: string, code: string): Promise<{ mfaVerified: true; remainingCodes: number; token: string }> {
    const now = new Date();
    const session = await this.loadSessionForChallenge(token, now);
    await this.assertMfaBudget(session.userId, now);

    const unused = await this.db.recoveryCode.findMany({ where: { userId: session.userId, usedAt: null }, select: { codeHash: true } });
    const match = findMatchingHash(code, unused.map((r) => r.codeHash));
    if (!match) {
      await this.bumpMfaThrottle(session.userId, 'FAILURE', now);
      throw new UnauthorizedException({ error: 'BAD_RECOVERY_CODE', reason: 'BAD_RECOVERY_CODE' });
    }
    // Rotated like the TOTP path (audit L2) — this route completes MFA too, so leaving the pre-MFA
    // bearer usable here would just move the hole rather than close it. Spending the code and
    // issuing the new session stay in ONE transaction: a code burned without a session to show for
    // it costs the user one of a small, unreplaceable set of papers.
    const { token: rotated, tokenHash } = newSessionToken();
    await this.db.$transaction([
      this.db.recoveryCode.update({ where: { codeHash: match }, data: { usedAt: now } }),
      this.db.session.update({ where: { id: session.id }, data: { revokedAt: now } }),
      this.db.session.create({
        data: {
          tokenHash,
          userId: session.userId,
          mfaVerified: true,
          mfaCompletedAt: now,
          // Still no stepUpAt: a code found on paper completes sign-in and does not open the file.
          createdAt: session.createdAt,
          lastSeenAt: now,
          expiresAt: session.expiresAt,
        },
      }),
    ]);
    await this.bumpMfaThrottle(session.userId, 'SUCCESS', now);
    const remainingCodes = await this.db.recoveryCode.count({ where: { userId: session.userId, usedAt: null } });
    return { mfaVerified: true, remainingCodes, token: rotated };
  }

  /**
   * Art. 17 erasure — the self-service path the schema promised and could never deliver (audit W14).
   *
   * WHY DELETION WAS NEVER AN OPTION. `RequestEvent` and `EvidenceRecord` are append-only by trigger
   * and hang off the user row, so the cascades declared in the schema could not fire — the promised
   * erasure endpoint was unbuildable, not merely unbuilt. And they must stay: an evidence chain that
   * can be edited is not evidence, and Art. 17(3)(e) preserves what is needed to defend legal claims
   * — which, for a product that sends legal letters in a user's name, is precisely that ledger.
   *
   * So the erasure is CRYPTOGRAPHIC. Destroying the DOSSIER key makes everything sealed under it
   * permanently unreadable; the ledger survives, and `UserKey.shreddedAt` is itself the evidence that
   * the erasure happened and when. What remains readable afterwards is the shape of the activity —
   * which controllers were written to, in which state each request ended — and nothing that names a
   * person.
   *
   * FOUR THINGS HAPPEN, and they are four because they have four different justifications:
   *   1. the DOSSIER key is shredded          — the erasure itself
   *   2. the AUTH key is shredded             — the TOTP secret becomes unopenable; the account is gone
   *   3. the residual plaintext is scrubbed   — email → hash, credentials and recovery codes deleted,
   *      credit-file rows deleted (see below), every session revoked
   *   4. `userErasedAt` is stamped            — `evaluateSession` has read this since port wave 3 and
   *      the API has been passing a hardcoded null; this is what finally makes that branch reachable
   *
   * The EVIDENCE key is deliberately NOT shredded. It becomes shreddable at
   * `evidenceShredDueAt(userErasedAt)` — three years from the year-end of the erasure, § 195 with
   * § 199(1) BGB — and a job destroys it then, which is what bounds the retention rather than leaving
   * it perpetual. TODO(counsel) on the window; the mechanism is not counsel's question.
   *
   * CREDIT-FILE ROWS ARE DELETED, NOT SHREDDED, and that is a stated limitation of this pass rather
   * than a design: `CreditFileEntry` is still plaintext (pass 2 seals it under DOSSIER, at which
   * point this delete becomes redundant and comes out). Deleting is correct in the meantime — an
   * erasure that left a parsed credit file behind would be no erasure at all — and those tables carry
   * no append-only trigger, so it is possible where it is not possible for the ledger.
   *
   * STEP-UP IS REQUIRED. This is the most irreversible action in the product and there is no undo:
   * one compromised, idle-but-live session must not be able to destroy someone's dossier. The same
   * gate that guards reading the credit file guards destroying it.
   */
  async eraseAccount(token: string): Promise<{ erasedAt: Date; requestsRetained: number }> {
    const now = new Date();
    const session = await this.db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    const verdict = evaluateSession(session ? toSessionState(session) : null, now);
    if (!verdict.ok) throw sessionRejection(verdict.reason);
    if (!verdict.stepUp) {
      throw new ForbiddenException({
        error: 'STEP_UP_REQUIRED',
        reason: 'STEP_UP_REQUIRED',
        nextAction: 'CONFIRM_SECOND_FACTOR',
      });
    }
    const userId = session!.userId;

    // ONE transaction. A half-erasure is the worst outcome available here: a shredded key with the
    // account still usable, or a scrubbed email with the dossier still readable, and no way for the
    // user to tell which they got.
    const requestsRetained = await this.db.$transaction(async (tx) => {
      const already = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { userErasedAt: true } });
      // Idempotent: a double-submitted erasure must not rewrite the stamp, because the FIRST date is
      // the one that would be produced as evidence and the one the EVIDENCE window is measured from.
      if (already.userErasedAt) return tx.rightsRequest.count({ where: { userId } });

      await tx.userKey.updateMany({
        where: { userId, purpose: 'DOSSIER', shreddedAt: null },
        data: { wrappedDek: null, shreddedAt: now },
      });
      await tx.creditFileSnapshot.deleteMany({ where: { userId } });
      await tx.authCredential.deleteMany({ where: { userId } });
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.user.update({
        where: { id: userId },
        data: {
          // The address is replaced by an opaque digest rather than deleted: `email` is UNIQUE and
          // NOT NULL, and the row must survive to hold the ledger. The digest is not reversible and
          // does not let the same person be recognised on a future registration — it exists so a
          // duplicate-erasure or abuse investigation has something to correlate on that is not a
          // mailbox. TODO(counsel): confirm a salted digest is the right residue here, or whether a
          // random tombstone with no link to the original address is preferable.
          email: `erased:${sha256Hex(session!.user.email)}`,
          wrappedDek: null,
          kekRef: null,
          totpEnrolledAt: null,
          // `totpLastCounter` is deliberately LEFT ALONE. Nulling it rewinds the replay defence, and
          // 0008's `totp_counter_monotonic` trigger refuses that — correctly, and it refused this
          // erasure until the line came out. It is an opaque integer that identifies nobody, the
          // secret it defended is deleted with the credential above, and keeping it costs nothing
          // while removing it would mean arguing with a safety trigger to erase a number.
          userErasedAt: now,
        },
      });
      return tx.rightsRequest.count({ where: { userId } });
    });

    return { erasedAt: now, requestsRetained };
  }

  async logout(token: string): Promise<void> {
    await this.db.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /**
   * Revoke everywhere — the control a user reaches for when they believe someone else is in their
   * account. Revokes the CALLING session too: "sign out everywhere" that leaves the caller signed in
   * is not what the words mean, and if the caller is the attacker it is the one session that matters.
   */
  async revokeAllSessions(token: string): Promise<{ revoked: number }> {
    const now = new Date();
    const session = await this.db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    const verdict = evaluateSession(session ? toSessionState(session) : null, now);
    if (!verdict.ok) throw sessionRejection(verdict.reason);
    const { count } = await this.db.session.updateMany({ where: { userId: session!.userId, revokedAt: null }, data: { revokedAt: now } });
    return { revoked: count };
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  /**
   * The session a half-authenticated caller may use for exactly one thing: completing the challenge.
   * Deliberately NOT `evaluateSession`, which would reject MFA_INCOMPLETE — that is the state every
   * caller of this method is legitimately in.
   */
  /**
   * A fixed hash to verify against when the email is unknown. Computed once per process and cached:
   * the point is to spend the same CPU as a real check, not to hash anything meaningful.
   */
  private decoy: Promise<string> | null = null;
  private decoyHash(): Promise<string> {
    this.decoy ??= hashPassword('scraper-timing-decoy-not-a-credential');
    return this.decoy;
  }

  private async loadSessionForChallenge(token: string, now: Date) {
    const session = await this.db.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException({ error: 'NO_SESSION', reason: 'NO_SESSION' });
    }
    return session;
  }

  /** Verify a TOTP code against the throttle AND the replay counter, then persist the counter. */
  private async consumeTotp(userId: string, code: string, now: Date): Promise<number> {
    await this.assertMfaBudget(userId, now);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, include: { authCredential: true } });
    const enc = user.authCredential?.totpSecretEnc;
    const secret = enc ? (await this.secrets.decrypt(userId, Buffer.from(enc))).toString('utf8') : null;
    const last = user.totpLastCounter === null || user.totpLastCounter === undefined ? null : Number(user.totpLastCounter);

    const verdict = secret ? verifyTotp(secret, code, now.getTime(), last) : ({ ok: false, reason: 'MISMATCH' } as const);
    if (!verdict.ok) {
      await this.bumpMfaThrottle(userId, 'FAILURE', now);
      // REPLAYED is reported as its own reason. It is a different event from a wrong code — it means
      // somebody presented a code that was already spent — and collapsing the two would hide exactly
      // the signal worth alerting on.
      throw new UnauthorizedException({ error: 'BAD_TOTP', reason: verdict.reason });
    }
    // CONDITIONAL write, and the condition is the replay defence.
    //
    // Reading the counter and then writing it unconditionally leaves a window in which two requests
    // presenting the SAME code both read the old value, both verify, and both succeed — which is
    // exactly the real-time relay a replay defence exists to stop. The predicate makes the database
    // the arbiter: only one UPDATE can move the counter to N, and the loser sees 0 rows and is told
    // REPLAYED, which is the truth. (The monotonic trigger cannot do this job: it permits an equal
    // write by design, because an equal write is not a rewind.)
    const advanced = await this.db.$executeRaw`
      UPDATE "User"
         SET "totpLastCounter" = ${BigInt(verdict.counter)},
             "failedMfaCount" = 0,
             "lastFailedMfaAt" = NULL
       WHERE "id" = ${userId}
         AND ("totpLastCounter" IS NULL OR "totpLastCounter" < ${BigInt(verdict.counter)})`;
    if (advanced === 0) {
      await this.bumpMfaThrottle(userId, 'FAILURE', now);
      throw new UnauthorizedException({ error: 'BAD_TOTP', reason: 'REPLAYED' });
    }
    return verdict.counter;
  }

  private async assertMfaBudget(userId: string, now: Date): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { failedMfaCount: true, lastFailedMfaAt: true },
    });
    const state: ThrottleState = { failedCount: user.failedMfaCount, lastFailedAt: user.lastFailedMfaAt };
    if (isLockedOut(state, MFA_THROTTLE, now)) {
      throw new ForbiddenException({
        error: 'RATE_LIMITED',
        reason: 'MFA_LOCKED',
        retryAfterSeconds: lockoutRemainingSeconds(state, MFA_THROTTLE, now),
      });
    }
  }

  private bumpLoginThrottle(userId: string, outcome: 'SUCCESS' | 'FAILURE', now: Date): Promise<void> {
    return this.bumpThrottle(userId, 'failedLoginCount', 'lastFailedLoginAt', LOGIN_THROTTLE, outcome, now);
  }

  private bumpMfaThrottle(userId: string, outcome: 'SUCCESS' | 'FAILURE', now: Date): Promise<void> {
    return this.bumpThrottle(userId, 'failedMfaCount', 'lastFailedMfaAt', MFA_THROTTLE, outcome, now);
  }

  /**
   * Move a throttle counter in ONE statement.
   *
   * This is deliberately raw SQL rather than a read, a `nextThrottleState()` and a write. That shape
   * — which this service had until the concurrency review — computes an ABSOLUTE next value from a
   * stale read, so N requests that race all read the same count and all write count+1: N guesses cost
   * one unit of the budget, and the lockout that is the only thing between a password holder and a
   * brute-forced second factor scales with the attacker's concurrency instead of bounding it.
   * `{ increment: 1 }` alone is not enough either, because the window-expiry reset is part of the same
   * decision and would race with it.
   *
   * The CASE below is `nextThrottleState`'s FAILURE branch expressed in SQL, evaluated under the row
   * lock the UPDATE takes. `packages/core/test/auth-policy.test.ts` still owns the policy; a test
   * asserts the two agree so the duplication cannot drift silently.
   */
  private async bumpThrottle(
    userId: string,
    countColumn: 'failedLoginCount' | 'failedMfaCount',
    atColumn: 'lastFailedLoginAt' | 'lastFailedMfaAt',
    policy: { readonly lockoutMinutes: number },
    outcome: 'SUCCESS' | 'FAILURE',
    now: Date,
  ): Promise<void> {
    if (outcome === 'SUCCESS') {
      // Idempotent and race-free: any interleaving still ends at zero.
      await this.db.$executeRawUnsafe(
        `UPDATE "User" SET "${countColumn}" = 0, "${atColumn}" = NULL WHERE "id" = $1`,
        userId,
      );
      return;
    }
    await this.db.$executeRawUnsafe(
      `UPDATE "User"
          SET "${countColumn}" = CASE
                WHEN "${atColumn}" IS NOT NULL AND $2::timestamp - "${atColumn}" >= make_interval(mins => $3::int)
                THEN 1
                ELSE "${countColumn}" + 1
              END,
              "${atColumn}" = $2::timestamp
        WHERE "id" = $1`,
      userId,
      now,
      policy.lockoutMinutes,
    );
  }
}

/** KEKs come from the environment in any deployed setting; the dev resolver is allow-listed to dev/test. */
/** Exported so every key-holding surface in this process resolves KEKs the same way (audit H1). */
export function kekResolver(): EnvKekResolver | DevKekResolver {
  return process.env.SCRAPER_KEK_MODE === 'env' ? new EnvKekResolver() : new DevKekResolver();
}

/** Shape-compatible with Prisma's cuid default — a decoy id distinguishable by FORMAT is an oracle. */
function decoyUserId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(24);
  let out = 'c';
  for (let i = 0; i < 24; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

function loginThrottle(user: { failedLoginCount: number; lastFailedLoginAt: Date | null }): ThrottleState {
  return { failedCount: user.failedLoginCount, lastFailedAt: user.lastFailedLoginAt };
}

/** The Prisma row → the pure policy's view of it. `userErasedAt` is reserved for the Art. 17 path. */
export function toSessionState(session: {
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  mfaCompletedAt: Date | null;
  stepUpAt: Date | null;
}) {
  return {
    userId: session.userId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt,
    revokedAt: session.revokedAt,
    mfaCompletedAt: session.mfaCompletedAt,
    stepUpAt: session.stepUpAt,
    // TODO(safety): self-service Art. 17 erasure is not built (docs/06 C2 "build our own Art. 15/17
    // endpoint"). The policy already refuses an erased user's session so the rejection exists the
    // day the column does; until then it is structurally null.
    userErasedAt: null as Date | null,
  };
}

/**
 * Map a rejection to a status. MFA_INCOMPLETE is 403, not 401: the credentials were right and the
 * client must FINISH the challenge rather than start over — a 401 would send a correctly
 * half-authenticated user back to the password screen in a loop.
 */
export function sessionRejection(reason: string): UnauthorizedException | ForbiddenException {
  if (reason === 'MFA_INCOMPLETE') return new ForbiddenException({ error: 'MFA_REQUIRED', reason });
  return new UnauthorizedException({ error: 'NO_SESSION', reason });
}
