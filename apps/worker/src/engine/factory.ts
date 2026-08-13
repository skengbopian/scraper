import type { WorkflowEngine } from '@scraper/core';
import { PgBossEngine } from '@scraper/api/dist/scheduler/pg-boss-engine.js';
import { BullMqWorkflowEngine } from './bullmq-engine.js';
import { TemporalWorkflowEngine } from './temporal-engine.js';

/**
 * Engine selection — A's SHAPE adopted, A's DEFAULT changed (ADR-031, port wave 5).
 *
 * The pre-audit line's contribution here is the factory itself: one `WorkflowEngine` interface, an
 * adapter per backend, and the choice made from config. That is strictly better than this line's
 * hard-wired pg-boss, because it is what makes the eventual Temporal migration a config change
 * rather than a rewrite of every call site. Adopted as-is.
 *
 * What changed is which adapter is default, and why:
 *
 *   - **pg-boss (default).** A statutory 30+ day Frist timer living in a Redis-protocol store is
 *     durability-sensitive: a misconfigured eviction policy silently drops a legal deadline. pg-boss
 *     is transactional with the request ledger in the same Postgres, and this line's implementation
 *     is already guarded and integration-tested against the corrected 16-state machine.
 *   - **BullMQ (retained, demoted).** A's work, kept so the decision stays reversible. It is lazily
 *     constructed so `bullmq`/`ioredis` are not build dependencies of a worker that does not use
 *     them — selecting it without installing them fails loudly at startup, not silently at the first
 *     timer.
 *   - **Temporal (the target).** Still a placeholder; ADR-004 and A's D2 already agree it is where
 *     this ends up.
 */
export type EngineName = 'pgboss' | 'bullmq' | 'temporal';

export const ENGINE_NAMES: readonly EngineName[] = ['pgboss', 'bullmq', 'temporal'];

export interface WorkflowEngineHandle {
  readonly name: EngineName;
  readonly engine: WorkflowEngine;
  close(): Promise<void>;
}

export interface EngineConfig {
  readonly engine: EngineName;
  readonly databaseUrl: string;
  readonly redisUrl: string;
}

export function createWorkflowEngine(config: EngineConfig): WorkflowEngineHandle {
  switch (config.engine) {
    case 'temporal':
      return { name: 'temporal', engine: new TemporalWorkflowEngine(), close: async () => undefined };
    case 'bullmq': {
      const engine = new BullMqWorkflowEngine(config.redisUrl);
      return { name: 'bullmq', engine, close: () => engine.close() };
    }
    case 'pgboss': {
      const engine = new PgBossEngine(config.databaseUrl);
      return { name: 'pgboss', engine, close: () => engine.stop() };
    }
  }
}
