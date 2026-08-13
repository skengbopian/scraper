import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import PgBoss from 'pg-boss';
import { PrismaClient } from '@prisma/client';
import type { DocSandbox, RawDocument, SandboxParseResult, TransitionResult } from '@scraper/core';
import { PrismaRequestsRepository } from '@scraper/api/repository';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { createWorkflowEngine } from './engine/factory.js';
import { ControllerGateway } from './gateway/controller-gateway.js';
import { SimulatedTimestamper, StubMailer, StubPostalProvider } from './providers/stub-providers.js';
import { PrismaWorkerRepository } from './repo/prisma-worker.repo.js';
import { handleDeadlineExpiry, sweepExpiredDeadlines, type DeadlinePayload } from './workflows/deadline.js';
import { dispatchReadyRequest, type DispatchDeps } from './workflows/dispatch.js';
import { ingestResponse, type IngestDeps } from './workflows/ingest.js';

/**
 * The worker process — port wave 5 (ADR-037).
 *
 * Three job types, each a thin shell over a workflow module that holds the decisions:
 *   `dispatch`        READY → SENT → the channel → the RIGHT clock (dispatch.ts)
 *   `deadline-expiry` provisional → the chase step; statutory → a DRAFTED complaint (deadline.ts)
 *   `ingest-response` a controller reply, from either waiting state (ingest.ts)
 *
 * NOTHING LEAVES THIS PROCESS TODAY, and that is enforced upstream rather than here: every shipped
 * playbook is `active: false` pending counsel sign-off, and `renderRequest()` refuses an inactive
 * one. So a real dispatch job renders nothing, sends nothing, and lands in the ops queue with the
 * reason. The wire path is complete and exercised; the counsel gate is what holds it shut.
 *
 * Run: DATABASE_URL=... node apps/worker/dist/main.js
 */

export { handleDeadlineExpiry, dispatchReadyRequest, ingestResponse };

const DISPATCH_BATCH = 25;

/**
 * A doc sandbox that refuses rather than guesses.
 *
 * The real parser is `services/doc-sandbox` (ADR-007/021: isolated, structured-output only, one
 * document per context). Until the worker is wired to it over its transport, this stand-in returns
 * confidence 0, which invariant 5 turns into NEEDS_HUMAN for every document. A stub that returned a
 * plausible parse would be worse than no parser at all: it would let hostile input reach a validated
 * outcome (docs/06 C4).
 */
class RefusingDocSandbox implements DocSandbox {
  async parse(doc: RawDocument): Promise<SandboxParseResult> {
    return {
      structured: {},
      confidence: 0,
      text: `[doc-sandbox not wired: document ${doc.id} (${doc.mimeType}) was NOT parsed]`,
    };
  }
}

function buildDispatchDeps(config: WorkerConfig, repo: PrismaWorkerRepository, requests: PrismaRequestsRepository, engine: DispatchDeps['engine']): DispatchDeps {
  const gateway = new ControllerGateway({
    mailer: new StubMailer(),
    postal: new StubPostalProvider(),
    timestamper: new SimulatedTimestamper(),
    appendEvidenceRecord: (record) => repo.appendEvidenceRecord(record),
    latestChainHash: (id) => repo.latestChainHash(id),
    hasOutboundEvidence: (id) => repo.hasOutboundEvidence(id),
    // No object store is configured; the ref is recorded so the chain is well-formed and the
    // artefact's absence is visible rather than implied.
    objectStorePut: async (key) => `unconfigured://${key}`,
    idFactory: () => `ev_${Math.random().toString(36).slice(2, 12)}`,
    now: () => new Date(),
  });

  return {
    load: (id) => repo.loadDispatchable(id),
    readTemplate: (templateId) => readFile(join(config.templatesDir, `${templateId}.md`), 'utf8'),
    gateway,
    applyTransition: (id, result: TransitionResult) => requests.applyTransition(id, result),
    recordHumanQueueEntry: (entry) => repo.recordHumanQueueEntry(entry),
    engine,
    log: (m) => console.log(`[dispatch] ${m}`),
    now: () => new Date(),
  };
}

function buildIngestDeps(config: WorkerConfig, repo: PrismaWorkerRepository, requests: PrismaRequestsRepository): IngestDeps {
  return {
    load: (id) => repo.loadIngestible(id),
    applyTransition: (id, result: TransitionResult) => requests.applyTransition(id, result),
    docSandbox: new RefusingDocSandbox(),
    outputSchemaFor: () => ({}),
    createControllerResponse: (row) => repo.createControllerResponse(row),
    saveProvenance: async (plan, req) => {
      if (plan.entries.length === 0) return;
      await requests.saveProvenanceEntries({
        requestId: req.snapshot.id,
        userId: req.snapshot.userId,
        controllerId: req.snapshot.controllerId,
        entries: plan.entries,
      });
    },
    rawResponseRetentionDays: config.rawResponseRetentionDays,
    log: (m) => console.log(`[ingest] ${m}`),
    now: () => new Date(),
  };
}

async function main(): Promise<void> {
  const config = loadWorkerConfig(process.env);
  const db = new PrismaClient();
  const requests = new PrismaRequestsRepository(db);
  const repo = new PrismaWorkerRepository(db);

  // ADR-031: the engine is a config choice. pg-boss by default; the queue the worker CONSUMES from
  // is pg-boss regardless, since that is what the API's scheduler produces into.
  const handle = createWorkflowEngine({ engine: config.engine, databaseUrl: config.databaseUrl, redisUrl: config.redisUrl });
  const dispatchDeps = buildDispatchDeps(config, repo, requests, handle.engine);
  const ingestDeps = buildIngestDeps(config, repo, requests);
  const deadlineDeps = {
    load: (id: string) => requests.load(id),
    applyTransition: (id: string, result: TransitionResult) => requests.applyTransition(id, result),
    now: () => new Date(),
    findDue: (now: Date) => repo.findDueDeadlines(now).then((rows) => rows as readonly DeadlinePayload[]),
  };

  const boss = new PgBoss({ connectionString: config.databaseUrl });
  boss.on('error', (e) => console.error('[pg-boss]', e));
  await boss.start();

  for (const queue of ['deadline-expiry', 'dispatch', 'ingest-response']) {
    await boss.createQueue(queue).catch(() => undefined);
  }

  await boss.work('deadline-expiry', async (jobs) => {
    for (const job of jobs) console.log(`[deadline-expiry] ${await handleDeadlineExpiry(deadlineDeps, job.data as DeadlinePayload)}`);
  });
  await boss.work('dispatch', async (jobs) => {
    for (const job of jobs) console.log(`[dispatch] ${await dispatchReadyRequest(dispatchDeps, (job.data as { requestId: string }).requestId)}`);
  });
  await boss.work('ingest-response', async (jobs) => {
    for (const job of jobs) {
      const d = job.data as { requestId: string; document: RawDocument; channel: 'email' | 'postal' | 'web_form' };
      console.log(`[ingest-response] ${await ingestResponse(ingestDeps, d)}`);
    }
  });

  // The READY sweep: the API creates requests without a queue dependency (docs/02), so the worker
  // picks them up rather than the API pushing. Also the backstop for a lost deadline timer — both
  // paths re-check state per row, so a sweep can never double-apply what a job already did.
  const sweep = async (): Promise<void> => {
    for (const id of await repo.findDispatchable(DISPATCH_BATCH)) {
      console.log(`[dispatch] ${await dispatchReadyRequest(dispatchDeps, id)}`);
    }
    for (const note of await sweepExpiredDeadlines(deadlineDeps)) {
      if (!note.startsWith('skip:')) console.log(`[deadline-sweep] ${note}`);
    }
  };
  const timer = setInterval(() => void sweep().catch((e) => console.error('[sweep]', e)), 15_000);
  timer.unref?.();

  console.log(
    `worker up: engine=${handle.name} queues=dispatch,deadline-expiry,ingest-response — ` +
      'providers are stubs, so a registered send CANNOT start a statutory clock (ADR-037)',
  );
}

const isMain = process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('main.ts');
if (isMain) void main();
