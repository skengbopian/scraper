import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import PgBoss from 'pg-boss';
import { PrismaClient } from '@prisma/client';
import { routeObjectRef, type SignoffManifest, type TransitionResult } from '@scraper/core';
import { PrismaRequestsRepository } from '@scraper/api/repository';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { createWorkflowEngine } from './engine/factory.js';
import { ControllerGateway } from './gateway/controller-gateway.js';
import { createProviders, type ResolvedProviders } from './providers/factory.js';
import { PrismaWorkerRepository } from './repo/prisma-worker.repo.js';
import { handleDeadlineExpiry, sweepExpiredDeadlines, type DeadlinePayload } from './workflows/deadline.js';
import { dispatchReadyRequest, type DispatchDeps } from './workflows/dispatch.js';
import { ingestResponse, reviveIngestJob, type IngestDeps } from './workflows/ingest.js';
import { sweepDueRawPurges, type PurgeDeps } from './workflows/purge.js';

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

function buildDispatchDeps(
  config: WorkerConfig,
  repo: PrismaWorkerRepository,
  requests: PrismaRequestsRepository,
  engine: DispatchDeps['engine'],
  providers: ResolvedProviders,
): DispatchDeps {
  const gateway = new ControllerGateway({
    mailer: providers.mailer,
    postal: providers.postal,
    timestamper: providers.timestamper,
    appendEvidenceRecord: (record) => repo.appendEvidenceRecord(record),
    latestChainHash: (id) => repo.latestChainHash(id),
    hasOutboundEvidence: (id) => repo.hasOutboundEvidence(id),
    countOutboundForControllerSince: (controllerId, since) => repo.countOutboundForControllerSince(controllerId, since),
    maxSendsPerControllerPerHour: config.maxSendsPerControllerPerHour,
    // Until this seam existed the ref was `unconfigured://<key>` — a well-formed reference to
    // nothing. The chain verified, the seal was green, and the letter we would have to produce at a
    // DPA existed nowhere. `put` throwing here is caught by the gateway BEFORE the channel call, so
    // a store that cannot keep the artefact stops the send instead of losing the evidence for it.
    objectStorePut: (key, bytes) => providers.objectStore.put(key, bytes),
    idFactory: () => `ev_${Math.random().toString(36).slice(2, 12)}`,
    now: () => new Date(),
  });

  return {
    load: (id) => repo.loadDispatchable(id),
    readTemplate: (templateId) => readFile(join(config.templatesDir, `${templateId}.md`), 'utf8'),
    readSignoffManifest: async () =>
      JSON.parse(await readFile(join(config.templatesDir, '.signoff.json'), 'utf8')) as SignoffManifest,
    // The runtime mirror of the boot allow-list: an unsigned letter renders in development and test
    // and nowhere else. `corpus:activate` gates activation the same way; this gates every dispatch,
    // because a template stays editable after it is activated.
    allowUnsignedTemplates: config.nodeEnv === 'development' || config.nodeEnv === 'test',
    gateway,
    applyTransition: (id, result: TransitionResult) => requests.applyTransition(id, result),
    recordHumanQueueEntry: (entry) => repo.recordHumanQueueEntry(entry),
    engine,
    log: (m) => console.log(`[dispatch] ${m}`),
    now: () => new Date(),
  };
}

function buildIngestDeps(
  config: WorkerConfig,
  repo: PrismaWorkerRepository,
  requests: PrismaRequestsRepository,
  providers: ResolvedProviders,
): IngestDeps {
  return {
    load: (id) => repo.loadIngestible(id),
    applyTransition: (id, result: TransitionResult) => requests.applyTransition(id, result),
    docSandbox: providers.docSandbox,
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
  const providers = createProviders(process.env);

  // ADR-031: the engine is a config choice. pg-boss by default; the queue the worker CONSUMES from
  // is pg-boss regardless, since that is what the API's scheduler produces into.
  const handle = createWorkflowEngine({ engine: config.engine, databaseUrl: config.databaseUrl, redisUrl: config.redisUrl });
  const dispatchDeps = buildDispatchDeps(config, repo, requests, handle.engine, providers);
  const ingestDeps = buildIngestDeps(config, repo, requests, providers);
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
      // The queue is a JSON boundary: `receivedAt` arrives as a string and `bytes` as an array.
      // Reviving here rather than trusting the shape is what stops a controller's reply being
      // recorded as "processing failed" with no ControllerResponse row (see reviveIngestJob).
      console.log(`[ingest-response] ${await ingestResponse(ingestDeps, reviveIngestJob(job.data))}`);
    }
  });

  // The READY sweep: the API creates requests without a queue dependency (docs/02), so the worker
  // picks them up rather than the API pushing. Also the backstop for a lost deadline timer — both
  // paths re-check state per row, and the repository compare-and-swaps the transition, so a sweep
  // can never double-apply what a job already did.
  // CLAUDE.md §4: the raw-document purge, previously a schema promise with no executor (audit M1).
  // The delete is real now. `routeObjectRef` is what keeps it honest in the middle case: a marker
  // reference has no blob and is skipped, a reference the configured store owns is deleted, and a
  // reference some OTHER store wrote is REFUSED — because tombstoning that row would record a purge
  // that did not happen while the raw hostile document stayed wherever it actually is.
  const purgeDeps: PurgeDeps = {
    findDueControllerResponsePurges: (now, limit) => repo.findDueControllerResponsePurges(now, limit),
    findDueInboundDocumentPurges: (now, limit) => repo.findDueInboundDocumentPurges(now, limit),
    deleteObject: async (ref) => {
      const routing = routeObjectRef(ref, providers.objectStore);
      if (routing.action === 'SKIP') return;
      // TODO(safety): a refused purge should raise an ops-queue entry, not only halt this row.
      // There is no surface for "retention could not be honoured" yet; the sweep names it on every
      // pass until an operator acts.
      if (routing.action === 'REFUSE') throw new Error(routing.reason);
      await providers.objectStore.delete(ref);
    },
    tombstoneControllerResponseRaw: (id) => repo.tombstoneControllerResponseRaw(id),
    tombstoneInboundDocumentRaw: (id, at) => repo.tombstoneInboundDocumentRaw(id, at),
    log: (m) => console.log(`[purge] ${m}`),
    now: () => new Date(),
  };

  let sweeping = false;
  const sweep = async (): Promise<void> => {
    // A pass slower than the interval must not overlap itself: two passes over the same READY rows
    // are exactly the double-dispatch race the CAS exists to lose safely — better not to run it.
    if (sweeping) return;
    sweeping = true;
    try {
      for (const id of await repo.findDispatchable(DISPATCH_BATCH)) {
        console.log(`[dispatch] ${await dispatchReadyRequest(dispatchDeps, id)}`);
      }
      for (const note of await sweepExpiredDeadlines(deadlineDeps)) {
        if (!note.startsWith('skip:')) console.log(`[deadline-sweep] ${note}`);
      }
      await sweepDueRawPurges(purgeDeps);
    } finally {
      sweeping = false;
    }
  };
  const timer = setInterval(() => void sweep().catch((e) => console.error('[sweep]', e)), 15_000);
  timer.unref?.();

  // Every seam, named. The failure this replaces was invisible: the selectors were validated and
  // then ignored, so an operator could read a correct environment and get a worker that sent
  // nowhere. What resolved is now the first thing in the log.
  console.log(`worker up: engine=${handle.name} queues=dispatch,deadline-expiry,ingest-response`);
  for (const line of providers.describe()) console.log(`  · ${line}`);
}

const isMain = process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('main.ts');
if (isMain) void main();
