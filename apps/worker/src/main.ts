import PgBoss from 'pg-boss';
import { PrismaClient } from '@prisma/client';
import { apply } from '@scraper/core';
import { PrismaRequestsRepository } from '@scraper/api/repository';

/**
 * The worker process: durable Frist timers (docs/10 P0; OQ-12 interim pick = pg-boss).
 *
 * One job type for now: `deadline-expiry` { requestId, kind: provisional|statutory }. The handler is
 * STATE-GUARDED — it re-loads the request and applies the expiry event only if the request still
 * waits in the matching state. A stale timer (response arrived meanwhile, resend already authorised,
 * duplicate delivery) becomes a logged no-op, never a wrong transition. Note what expiry does per
 * clock: a PROVISIONAL deadline expiring leads to the chase step (AWAITING_REGISTERED_RESEND) — the
 * user decides about the registered re-send; only a STATUTORY deadline expiring drafts an escalation
 * (silence path, invariant 3a: structurally only reachable after a provable send). Nothing here
 * sends anything.
 *
 * Run: SCRAPER_SCHEDULER=pgboss DATABASE_URL=... node apps/worker/dist/main.js
 */
interface DeadlinePayload {
  readonly requestId: string;
  readonly kind: 'provisional' | 'statutory';
}

export async function handleDeadlineExpiry(repo: PrismaRequestsRepository, payload: DeadlinePayload): Promise<string> {
  const r = await repo.load(payload.requestId);
  if (!r) return `skip: request ${payload.requestId} not found`;
  if (payload.kind === 'provisional' && r.state === 'AWAITING_RESPONSE_PROVISIONAL') {
    await repo.applyTransition(r.id, apply(r, 'provisionalDeadlineExpired', { actor: 'SYSTEM', now: new Date() }));
    return `provisional deadline expired → AWAITING_REGISTERED_RESEND (${r.id})`;
  }
  if (payload.kind === 'statutory' && r.state === 'AWAITING_RESPONSE') {
    await repo.applyTransition(r.id, apply(r, 'deadlineExpired', { actor: 'SYSTEM', now: new Date() }));
    return `statutory deadline expired → ESCALATION_DRAFTED (${r.id}) — drafted, never auto-sent`;
  }
  return `skip: ${r.id} is in ${r.state}, timer is stale`;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('worker requires DATABASE_URL');
  const db = new PrismaClient();
  const repo = new PrismaRequestsRepository(db);
  const boss = new PgBoss({ connectionString: url });
  boss.on('error', (e) => console.error('[pg-boss]', e));
  await boss.start();
  await boss.createQueue('deadline-expiry').catch(() => undefined);
  await boss.work('deadline-expiry', async (jobs) => {
    for (const job of jobs) {
      const note = await handleDeadlineExpiry(repo, job.data as DeadlinePayload);
      console.log(`[deadline-expiry] ${note}`);
    }
  });
  console.log('worker up: deadline-expiry handler registered');
}

const isMain = process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('main.ts');
if (isMain) void main();
