import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * The HUMAN_OPS grant, against real Postgres (skipped without DATABASE_URL_TEST, like the other DB
 * suites).
 *
 * Written as refusals first. The happy path here is one column update, and it is not the part that
 * can hurt anyone — a CLI that hands out the most privileged role in the product is defined by what
 * it declines to do. Each refusal below is a way an operator could plausibly end up with a
 * privileged account they did not mean to create.
 */
const url = process.env.DATABASE_URL_TEST;

describe.skipIf(!url)('grant-ops', () => {
  let db: PrismaClient;
  const EMAIL = 'grantops-subject@example.com';
  const NEVER_ENROLLED = 'grantops-noTotp@example.com'.toLowerCase();
  const ERASED = 'grantops-erased@example.com';
  let subjectId = '';

  const load = () => import('../dist/db/grant-ops.js');

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanUp();
    const created = await db.user.create({ data: { email: EMAIL, totpEnrolledAt: new Date() }, select: { id: true } });
    subjectId = created.id;
    await db.user.create({ data: { email: NEVER_ENROLLED } });
    await db.user.create({ data: { email: ERASED, userErasedAt: new Date('2026-08-01T00:00:00Z') } });
  }, 30_000);

  afterAll(async () => {
    await cleanUp();
    await db?.$disconnect();
  });

  async function cleanUp(): Promise<void> {
    if (!db) return;
    await db.user.deleteMany({ where: { email: { in: [EMAIL, NEVER_ENROLLED, ERASED] } } });
  }

  it('grants the role, and reports the transition', async () => {
    const { grantOps } = await load();
    const r = await grantOps(db, 'grant', EMAIL);
    expect(r).toMatchObject({ action: 'grant', userId: subjectId, was: 'USER', now: 'HUMAN_OPS' });
    expect((await db.user.findUniqueOrThrow({ where: { id: subjectId } })).role).toBe('HUMAN_OPS');
  });

  it('is idempotent and says so, rather than reporting a change that did not happen', async () => {
    const { grantOps } = await load();
    const r = await grantOps(db, 'grant', EMAIL);
    expect(r.was).toBe('HUMAN_OPS');
    expect(r.now).toBe('HUMAN_OPS');
  });

  it('lists who holds the role', async () => {
    const { listOps } = await load();
    const { operators } = await listOps(db);
    expect(operators?.map((o) => o.email)).toContain(EMAIL);
  });

  it('revokes it — a grant with no way back is not a grant anyone should make', async () => {
    const { grantOps } = await load();
    const r = await grantOps(db, 'revoke', EMAIL);
    expect(r).toMatchObject({ was: 'HUMAN_OPS', now: 'USER' });
    expect((await db.user.findUniqueOrThrow({ where: { id: subjectId } })).role).toBe('USER');
  });

  it('matches on a normalised address, so a capitalised email is not a second account', async () => {
    const { grantOps } = await load();
    const r = await grantOps(db, 'grant', `  ${EMAIL.toUpperCase()}  `);
    expect(r.userId).toBe(subjectId);
    await grantOps(db, 'revoke', EMAIL);
  });

  it('REFUSES an unknown address instead of creating the account', async () => {
    const { grantOps } = await load();
    await expect(grantOps(db, 'grant', 'nobody@example.invalid')).rejects.toThrow(/no account with email/);
    expect(await db.user.count({ where: { email: 'nobody@example.invalid' } })).toBe(0);
  });

  it('REFUSES an erased account — a tombstone is not an operator', async () => {
    const { grantOps } = await load();
    await expect(grantOps(db, 'grant', ERASED)).rejects.toThrow(/erased/);
    expect((await db.user.findFirstOrThrow({ where: { email: ERASED } })).role).toBe('USER');
  });

  it('REFUSES an account with no second factor — the ops surface is not password-only', async () => {
    const { grantOps } = await load();
    await expect(grantOps(db, 'grant', NEVER_ENROLLED)).rejects.toThrow(/second factor/);
  });

  it('still REVOKES from an account with no second factor — taking privilege away is never gated', async () => {
    const { grantOps } = await load();
    await db.user.updateMany({ where: { email: NEVER_ENROLLED }, data: { role: 'HUMAN_OPS' } });
    const r = await grantOps(db, 'revoke', NEVER_ENROLLED);
    expect(r.now).toBe('USER');
  });

  it('refuses an empty address', async () => {
    const { grantOps } = await load();
    await expect(grantOps(db, 'grant', '   ')).rejects.toThrow(/email address is required/);
  });
});

/**
 * Argument parsing has no database dependency, so it runs everywhere — including on the laptop of
 * whoever is about to type this command wrong.
 */
describe('grant-ops argument parsing', () => {
  const load = () => import('../dist/db/grant-ops.js');

  it('defaults to granting', async () => {
    const { parseArgs } = await load();
    expect(parseArgs(['a@example.com'])).toEqual({ action: 'grant', email: 'a@example.com' });
  });

  it('reads --revoke and --list', async () => {
    const { parseArgs } = await load();
    expect(parseArgs(['--revoke', 'a@example.com'])).toEqual({ action: 'revoke', email: 'a@example.com' });
    expect(parseArgs(['--list'])).toEqual({ action: 'list' });
  });

  it('refuses two addresses rather than picking one', async () => {
    const { parseArgs } = await load();
    expect(() => parseArgs(['a@example.com', 'b@example.com'])).toThrow(/exactly one email/);
  });

  it('refuses no address at all', async () => {
    const { parseArgs } = await load();
    expect(() => parseArgs([])).toThrow(/exactly one email/);
  });
});
