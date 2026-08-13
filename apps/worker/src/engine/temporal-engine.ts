import type { WorkflowEngine } from '@scraper/core';

const PENDING =
  'the Temporal adapter is not implemented. Temporal remains the production target (ADR-004, ' +
  'ADR-031); pg-boss is the interim default. Set SCRAPER_WORKFLOW_ENGINE=pgboss.';

/**
 * Placeholder so the `SCRAPER_WORKFLOW_ENGINE=temporal` path is TYPED today, ported from A.
 *
 * It throws rather than silently no-opping, and that is the whole design: a scheduler that accepts a
 * Frist timer and drops it produces a request whose statutory deadline never expires, whose
 * escalation never drafts, and which looks perfectly healthy in every view. A loud failure at the
 * first schedule is recoverable; a silent one is a missed legal deadline discovered a month later.
 */
export class TemporalWorkflowEngine implements WorkflowEngine {
  async schedule(): Promise<void> {
    throw new Error(PENDING);
  }

  async cancel(): Promise<void> {
    throw new Error(PENDING);
  }
}
