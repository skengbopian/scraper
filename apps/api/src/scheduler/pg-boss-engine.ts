import PgBoss from 'pg-boss';
import type { WorkflowEngine } from '@scraper/core';

/**
 * WorkflowEngine on pg-boss (OQ-12 decision input: Postgres-native, MIT, timers-as-rows — durable
 * 30+-day Frist timers with zero extra infrastructure; Temporal stays the production target).
 *
 * Idempotency contract: `singletonKey` dedupes scheduling (same key while a job is queued ⇒ no
 * second job), and the HANDLER is state-guarded (it re-checks the request state before applying),
 * so even a stale or duplicate timer can never double-fire a transition. The authoritative
 * double-send guard remains the request ledger (CLAUDE.md §8) — the queue is never the ledger.
 *
 * cancel(): pg-boss cancels by job id, not key; the send-side keeps a process-local key→id map for
 * best-effort cancellation, and correctness never depends on it (state guard above).
 */
export class PgBossEngine implements WorkflowEngine {
  private boss: PgBoss | null = null;
  private readonly jobIds = new Map<string, { name: string; id: string }>();

  constructor(private readonly databaseUrl: string) {}

  private async started(): Promise<PgBoss> {
    if (!this.boss) {
      this.boss = new PgBoss({ connectionString: this.databaseUrl });
      await this.boss.start();
    }
    return this.boss;
  }

  async schedule(key: string, runAt: Date, task: { name: string; payload: Readonly<Record<string, unknown>> }): Promise<void> {
    const boss = await this.started();
    await boss.createQueue(task.name).catch(() => undefined);
    const id = await boss.send(task.name, { ...task.payload, key }, {
      startAfter: runAt,
      singletonKey: key,
      retryLimit: 3,
      retryBackoff: true,
    });
    if (id) this.jobIds.set(key, { name: task.name, id });
  }

  async cancel(key: string): Promise<void> {
    const ref = this.jobIds.get(key);
    if (!ref) return; // best-effort: cross-process cancels rely on the handler's state guard
    const boss = await this.started();
    await boss.cancel(ref.name, ref.id).catch(() => undefined);
    this.jobIds.delete(key);
  }

  async stop(): Promise<void> {
    await this.boss?.stop({ graceful: false });
    this.boss = null;
  }
}
