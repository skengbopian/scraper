import { PrismaClient } from '@prisma/client';

/**
 * Grant, revoke and list the HUMAN_OPS role — from a shell, against the database, never over HTTP.
 *
 * `OpsRoleGuard` reads `User.role` from the database, and NOTHING in the tree wrote it outside one
 * line of `ops.e2e.test.ts`. On a freshly stood-up node every ops surface was therefore unreachable:
 * the review queue, the anomaly panel, and — the one that matters — `POST
 * /ops/requests/:id/delivery-proof`, the only route in the product that can start an Art. 12(3)
 * clock (CLAUDE.md §6). A single-operator posture-A node had a delivery receipt, a paper original in
 * hand, and no person allowed to key it in.
 *
 * WHY THIS IS NOT A ROUTE. The obvious fix — a bootstrap endpoint that promotes the first user, or
 * an ops screen with a "make admin" button — is a privilege-escalation surface guarding the most
 * privileged surface in the product. Ops routes read across users' request ledgers, which is a map
 * of who is exercising rights against whom: exactly the targeting signal CLAUDE.md's one rule exists
 * to suppress. Any HTTP path to the role can be reached by an attacker who reaches the HTTP server;
 * this one requires the database credential, which is a different and much smaller set of people. A
 * "first user wins" bootstrap is worse still, since it turns a race on a public registration form
 * into an ops account.
 *
 * Needs only DATABASE_URL: no KEK, no CORS list, no NODE_ENV. It touches one enum column and reads
 * nothing sealed, so an operator can run it against a node they cannot otherwise fully configure —
 * which is the situation the operator is actually in.
 *
 * TODO(safety): this makes an ordinary account privileged rather than creating a separate ops
 * identity, so a compromised ops password is still a compromised ops surface. Dedicated ops
 * credentials and per-actor attribution in the evidence chain are the real answer (OQ-27, and see
 * OpsRoleGuard's own note).
 */

export type GrantAction = 'grant' | 'revoke' | 'list';

export interface GrantResult {
  readonly action: GrantAction;
  readonly email?: string;
  readonly userId?: string;
  /** The role before the change; equal to the role after when the call was a no-op. */
  readonly was?: 'USER' | 'HUMAN_OPS';
  readonly now?: 'USER' | 'HUMAN_OPS';
  readonly operators?: readonly { readonly email: string; readonly id: string }[];
}

export class GrantOpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrantOpsError';
  }
}

/**
 * Promote or demote one existing account.
 *
 * Refuses in four cases, each of which is a real way to get this wrong:
 *
 *   no such user   — it will NOT create one. An account-creating CLI is a registration path that
 *                    skips password policy and second-factor enrolment entirely, and it would let a
 *                    typo silently mint a privileged account instead of failing.
 *   erased user    — a tombstoned row (Art. 17) is not an operator. Its keys are shredded and its
 *                    address is a digest; granting it a role would resurrect an account the person
 *                    asked us to destroy.
 *   no second factor — the ops surface behind a password alone is not a surface anyone should have.
 *                    Enrolment happens at registration, so this only fires for accounts mid-erasure
 *                    or predating the auth policy.
 *   ambiguous match — email is UNIQUE, so this cannot happen through the schema; it is checked
 *                    because a lookup that silently picked one of several rows would be the worst
 *                    possible failure here.
 */
export async function grantOps(db: PrismaClient, action: 'grant' | 'revoke', rawEmail: string): Promise<GrantResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) throw new GrantOpsError('an email address is required');

  const matches = await db.user.findMany({
    where: { email },
    select: { id: true, email: true, role: true, userErasedAt: true, totpEnrolledAt: true },
  });
  if (matches.length === 0) {
    throw new GrantOpsError(
      `no account with email "${email}". This tool never creates one: register through the ` +
        'application first, confirm the second factor, then re-run. A CLI that could create an ' +
        'account would be a registration path with no password policy and no TOTP enrolment.',
    );
  }
  if (matches.length > 1) {
    throw new GrantOpsError(`${matches.length} accounts match "${email}" — refusing to guess which one you meant`);
  }
  const user = matches[0]!;

  if (user.userErasedAt) {
    throw new GrantOpsError(
      `"${email}" was erased on ${user.userErasedAt.toISOString()} (Art. 17). Its keys are shredded ` +
        'and the row survives only to hold an append-only ledger. It is a tombstone, not an operator.',
    );
  }
  if (action === 'grant' && !user.totpEnrolledAt) {
    throw new GrantOpsError(
      `"${email}" has no second factor enrolled. The ops surface reads across users' request ` +
        'ledgers and can start a statutory clock; it is not something to put behind a password ' +
        'alone. Complete TOTP enrolment, then re-run.',
    );
  }

  const target = action === 'grant' ? 'HUMAN_OPS' : 'USER';
  if (user.role === target) {
    return { action, email: user.email, userId: user.id, was: user.role, now: user.role };
  }
  await db.user.update({ where: { id: user.id }, data: { role: target } });
  return { action, email: user.email, userId: user.id, was: user.role, now: target };
}

/** Who currently holds the role. The answer to "did I already do this, and to whom?". */
export async function listOps(db: PrismaClient): Promise<GrantResult> {
  const operators = await db.user.findMany({
    where: { role: 'HUMAN_OPS' },
    select: { id: true, email: true },
    orderBy: { email: 'asc' },
  });
  return { action: 'list', operators };
}

const USAGE = `usage:
  grant-ops <email>            grant HUMAN_OPS to an existing, TOTP-enrolled account
  grant-ops --revoke <email>   take it away
  grant-ops --list             who holds it

Requires DATABASE_URL. There is deliberately no HTTP equivalent — see the header of this file.`;

export function parseArgs(argv: readonly string[]): { action: GrantAction; email?: string } {
  const args = argv.filter((a) => a !== '');
  if (args.includes('--list')) return { action: 'list' };
  const revoke = args.includes('--revoke');
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length !== 1) throw new GrantOpsError(`expected exactly one email address\n\n${USAGE}`);
  return { action: revoke ? 'revoke' : 'grant', email: positional[0] };
}

const isMain = process.argv[1]?.endsWith('grant-ops.js');
if (isMain) {
  const log = (s: string) => process.stdout.write(`${s}\n`);
  const db = new PrismaClient();
  (async () => {
    if (!process.env.DATABASE_URL) throw new GrantOpsError('DATABASE_URL is required');
    const { action, email } = parseArgs(process.argv.slice(2));
    if (action === 'list') {
      const { operators } = await listOps(db);
      if (!operators || operators.length === 0) {
        log('no account holds HUMAN_OPS — every ops surface on this node is unreachable, including');
        log('the delivery-proof route that starts an Art. 12(3) clock.');
        return;
      }
      log(`${operators.length} HUMAN_OPS account(s):`);
      for (const o of operators) log(`  ${o.email}  (${o.id})`);
      return;
    }
    const r = await grantOps(db, action, email!);
    if (r.was === r.now) log(`no change: ${r.email} already has role ${r.now} (${r.userId})`);
    else log(`${r.email}: ${r.was} → ${r.now}  (${r.userId})`);
  })()
    .catch((e: unknown) => {
      process.stderr.write(`grant-ops: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    })
    .finally(() => void db.$disconnect());
}
