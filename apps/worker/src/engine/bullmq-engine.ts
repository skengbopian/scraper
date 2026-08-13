import type { WorkflowEngine } from '@scraper/core';

/**
 * The BullMQ adapter — retained from the pre-audit line, demoted to second choice (ADR-031).
 *
 * Kept for one reason: the decision to default to pg-boss is reversible, and it stays reversible
 * only if the alternative still exists. Deleting it would make "switch engines" a rewrite again,
 * which is exactly what adopting A's factory was meant to prevent.
 *
 * `bullmq` and `ioredis` are NOT declared dependencies of this package. That is deliberate: a
 * Redis client in the dependency tree of a worker that does not use Redis is a supply-chain and
 * image-size cost for a code path nobody selected. They are imported dynamically, so choosing this
 * engine without installing them fails at startup with a clear message rather than at the first
 * Frist timer with a module-not-found — which, for a 30-day legal deadline, would surface a month
 * after the mistake.
 *
 * Two behaviours ported from A because they were hard-won:
 *   - the caller's idempotency key maps onto BullMQ's `jobId`, which dedupes while the job exists;
 *   - the key must carry the run timestamp, because BullMQ dedupes across COMPLETED jobs too — a
 *     static key would make a second deferral a silent no-op and strand the request forever.
 */
export class BullMqWorkflowEngine implements WorkflowEngine {
  private queue: Promise<BullQueue> | null = null;

  constructor(private readonly redisUrl: string) {}

  private async connect(): Promise<BullQueue> {
    if (!this.queue) {
      this.queue = (async () => {
        let bullmq: { Queue: new (name: string, opts: { connection: unknown }) => BullQueue };
        let ioredis: { default: new (url: string, opts: { maxRetriesPerRequest: null }) => unknown };
        try {
          // The specifiers are variables so the compiler does not try to resolve modules that are
          // deliberately not dependencies (see the class comment). Selecting this engine without
          // installing them fails HERE, at startup, with the message below.
          const [bullmqId, ioredisId] = ['bullmq', 'ioredis'];
          bullmq = (await import(bullmqId as string)) as never;
          ioredis = (await import(ioredisId as string)) as never;
        } catch (e) {
          throw new Error(
            'SCRAPER_WORKFLOW_ENGINE=bullmq requires the optional "bullmq" and "ioredis" packages, ' +
              'which are not installed (the default engine is pg-boss — ADR-031). ' +
              `Install them or select pgboss. Underlying error: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        const connection = new ioredis.default(this.redisUrl, { maxRetriesPerRequest: null });
        return new bullmq.Queue('rights-request', { connection });
      })();
    }
    return this.queue;
  }

  async schedule(key: string, runAt: Date, task: { name: string; payload: Readonly<Record<string, unknown>> }): Promise<void> {
    const queue = await this.connect();
    await queue.add(task.name, { ...task.payload, key }, { delay: Math.max(0, runAt.getTime() - Date.now()), jobId: key });
  }

  async cancel(key: string): Promise<void> {
    const queue = await this.connect();
    const job = await queue.getJob(key);
    await job?.remove();
  }

  async close(): Promise<void> {
    if (!this.queue) return;
    await (await this.queue).close();
    this.queue = null;
  }
}

/** The slice of BullMQ's `Queue` this adapter uses — typed here so `bullmq` need not be installed. */
interface BullQueue {
  add(name: string, data: unknown, opts: { delay: number; jobId: string }): Promise<unknown>;
  getJob(id: string): Promise<{ remove(): Promise<unknown> } | undefined>;
  close(): Promise<void>;
}
