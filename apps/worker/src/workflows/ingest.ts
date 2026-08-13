import {
  apply,
  validateResponse,
  type DocSandbox,
  type Playbook,
  type RawDocument,
  type RequestSnapshot,
  type TransitionResult,
} from '@scraper/core';
import { ingestProvenanceResponse, type ProvenanceIngestPlan } from './provenance.js';

/**
 * Response ingestion — port wave 5, re-derived (ADR-037).
 *
 * ---------------------------------------------------------------------------------------------
 * HAZARD 4, CLOSED: emailed replies are not dropped
 * ---------------------------------------------------------------------------------------------
 * The pre-audit line gates ingest on a single state:
 *
 *     // apps/worker/src/workflows/ingest-response.ts:109 (repo A)
 *     if (row.state !== 'AWAITING_RESPONSE') { log.info(...); return; }
 *
 * In that line every send reached AWAITING_RESPONSE, so the gate was total. Here an emailed send
 * lands in AWAITING_RESPONSE_PROVISIONAL, so that line ported unchanged would SILENTLY DISCARD every
 * controller reply to an emailed request — the most common case — logging it at info level as a
 * skip. The user would see a request that was answered sitting forever on "waiting".
 *
 * The set below is therefore derived from the transition table rather than written by hand: every
 * state carrying a `responseIngested` edge accepts a reply. That includes the late-reply states
 * (INCOMPLETE, REFUSED, ESCALATION_DRAFTED, ESCALATED — H1), which the single-state gate also lost.
 *
 * ---------------------------------------------------------------------------------------------
 * INVARIANT 5: the confidence floor runs BEFORE any outcome assessment
 * ---------------------------------------------------------------------------------------------
 * `validateResponse()` checks the playbook's `humanReviewIfConfidenceBelow` first and
 * unconditionally, and `ingestProvenanceResponse()` only assesses the source list on a verdict that
 * already cleared it. A hostile PDF must not reach a decision because it happened to contain a
 * matching phrase (docs/06 C4). The ordering is the guarantee; nothing here may reorder it.
 */

/** States from which `responseIngested` is a legal edge — see transitions.ts, kept in sync by test. */
export const INGESTIBLE_STATES: readonly RequestSnapshot['state'][] = [
  'AWAITING_RESPONSE_PROVISIONAL',
  'AWAITING_RESPONSE',
  'AWAITING_REGISTERED_RESEND',
  'INCOMPLETE',
  'REFUSED',
  'ESCALATION_DRAFTED',
  'ESCALATED',
];

export interface IngestibleRequest {
  readonly snapshot: RequestSnapshot;
  readonly playbook: Playbook;
  readonly controllerSlug: string;
}

export interface ControllerResponseRow {
  readonly requestId: string;
  readonly receivedAt: Date;
  readonly channel: 'email' | 'postal' | 'web_form';
  readonly rawDocumentRef: string;
  /** docs/03 retention: the raw document is purged after the normalisation window. */
  readonly purgeRawAt: Date;
  readonly structured: Readonly<Record<string, unknown>>;
  readonly parseConfidence: number;
}

export interface IngestDeps {
  readonly load: (requestId: string) => Promise<IngestibleRequest | null>;
  readonly applyTransition: (requestId: string, result: TransitionResult) => Promise<void>;
  readonly docSandbox: DocSandbox;
  readonly outputSchemaFor: (requestType: string) => Readonly<Record<string, unknown>>;
  readonly createControllerResponse: (row: ControllerResponseRow) => Promise<{ id: string }>;
  readonly saveProvenance: (plan: ProvenanceIngestPlan, req: IngestibleRequest) => Promise<void>;
  readonly rawResponseRetentionDays: number;
  readonly log: (message: string) => void;
  readonly now: () => Date;
}

export interface IngestInput {
  readonly requestId: string;
  readonly document: RawDocument;
  readonly channel: 'email' | 'postal' | 'web_form';
}

export class MalformedIngestJobError extends Error {
  constructor(message: string) {
    super(`ingest job payload is malformed: ${message}`);
    this.name = 'MalformedIngestJobError';
  }
}

/**
 * Rebuild an `IngestInput` from a queue payload.
 *
 * A durable queue is a JSON boundary, and JSON has no Date and no Uint8Array. Reading
 * `document.receivedAt` off a delivered job gives a STRING, so `receivedAt.getTime()` throws — which
 * is how this was found, at runtime, against the real worker. The failure was caught (the request
 * fails closed to NEEDS_HUMAN) but the reply was lost on the way: no `ControllerResponse` row was
 * written, so the answer a controller actually sent left no record. For a workflow whose entire
 * purpose is not to drop replies, "it failed safely" is not good enough.
 *
 * So the boundary is parsed rather than trusted, in one place, and a payload that cannot be revived
 * is rejected loudly instead of being handed on as a plausible-looking object.
 */
export function reviveIngestJob(payload: unknown): IngestInput {
  const p = payload as { requestId?: unknown; channel?: unknown; document?: Record<string, unknown> };
  const doc = p.document;
  if (typeof p.requestId !== 'string' || !doc) throw new MalformedIngestJobError('requestId and document are required');

  const channels = ['email', 'postal', 'web_form'] as const;
  if (!channels.includes(p.channel as (typeof channels)[number])) {
    throw new MalformedIngestJobError(`channel must be one of ${channels.join(', ')}`);
  }

  const receivedAt = new Date(String(doc.receivedAt ?? ''));
  if (Number.isNaN(receivedAt.getTime())) {
    // Not a detail: receivedAt sets the retention purge date (CLAUDE.md §4). A silently-wrong one
    // would keep a raw controller document past its window, or purge it before it was normalised.
    throw new MalformedIngestJobError(`document.receivedAt is not a date: ${String(doc.receivedAt)}`);
  }

  return {
    requestId: p.requestId,
    channel: p.channel as IngestInput['channel'],
    document: {
      id: String(doc.id ?? ''),
      mimeType: String(doc.mimeType ?? 'application/octet-stream'),
      bytes: Uint8Array.from(Array.isArray(doc.bytes) ? (doc.bytes as number[]) : []),
      receivedAt,
    },
  };
}

export async function ingestResponse(deps: IngestDeps, input: IngestInput): Promise<string> {
  const row = await deps.load(input.requestId);
  if (!row) return `skip: request ${input.requestId} not found`;
  if (!INGESTIBLE_STATES.includes(row.snapshot.state)) {
    return `skip: ${row.snapshot.id} is in ${row.snapshot.state}, which has no responseIngested edge`;
  }

  await deps.applyTransition(
    row.snapshot.id,
    apply(row.snapshot, 'responseIngested', { actor: 'SYSTEM', now: deps.now() }),
  );
  const received: RequestSnapshot = { ...row.snapshot, state: 'RESPONSE_RECEIVED', hasControllerResponse: true };

  // Everything below is fallible against hostile input (sandbox outage, corrupt document, storage
  // failure). Fail CLOSED to NEEDS_HUMAN rather than stranding the request in RESPONSE_RECEIVED,
  // which has no timer and would silently stop.
  try {
    return await decide(deps, row, received, input);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deps.log(`request ${received.id}: response processing failed — routing to ops: ${message}`);
    await deps.applyTransition(
      received.id,
      apply(received, 'lowConfidence|ambiguous', { actor: 'SYSTEM', now: deps.now(), reason: message.slice(0, 300) }),
    );
    return `${received.id}: ingest failed → NEEDS_HUMAN (${message})`;
  }
}

async function decide(
  deps: IngestDeps,
  row: IngestibleRequest,
  received: RequestSnapshot,
  input: IngestInput,
): Promise<string> {
  // C4: the sandbox parses ONE hostile document in isolation. Its output is ADVISORY — it may not
  // trigger an irreversible action, and it never writes request state.
  const parsedRaw = await deps.docSandbox.parse(input.document, deps.outputSchemaFor(row.snapshot.requestType));
  const parsed = {
    text: parsedRaw.text,
    structured: parsedRaw.structured,
    confidence: parsedRaw.confidence,
    // The worker is never a human reviewer. Only the ops surface may set this (invariant 5).
    reviewedByHuman: false,
  };

  const receivedAt = input.document.receivedAt;
  const response = await deps.createControllerResponse({
    requestId: received.id,
    receivedAt,
    channel: input.channel,
    rawDocumentRef: input.document.id,
    purgeRawAt: new Date(receivedAt.getTime() + deps.rawResponseRetentionDays * 86_400_000),
    structured: parsed.structured,
    parseConfidence: parsed.confidence,
  });

  // The snapshot the machine judges against carries the playbook's floor and this parse's
  // confidence. Without both, invariant 5's guard in `apply()` has nothing to compare.
  const judged: RequestSnapshot = {
    ...received,
    parseConfidence: parsed.confidence,
    humanReviewIfConfidenceBelow: row.playbook.validation.humanReviewIfConfidenceBelow,
  };

  if (row.snapshot.requestType === 'ACCESS_ART15_SOURCE') {
    // The provenance path runs the floor first too — `ingestProvenanceResponse` calls
    // `validateResponse` before it looks at the source list at all, so an incomplete-source finding
    // can never be what lets a low-confidence parse reach a decision.
    const plan = ingestProvenanceResponse({
      playbook: row.playbook,
      request: judged,
      parsed,
      rawEntries: (parsedRaw.structured.entries as ProvenanceRawEntries | undefined) ?? [],
      bureauSlug: row.controllerSlug,
      now: deps.now(),
    });
    await deps.applyTransition(received.id, plan.transition);
    await deps.saveProvenance(plan, row);
    return `${received.id}: response ${response.id} → ${plan.transition.to}${plan.notes.length ? ` (${plan.notes.join('; ')})` : ''}`;
  }

  const verdict = validateResponse(row.playbook, parsed);
  const result = apply(judged, verdict.event, {
    actor: 'SYSTEM',
    now: deps.now(),
    // "Low confidence" and "nothing matched" are different problems with different fixes, and the
    // ops reviewer is the one who has to tell them apart. Carrying the verdict's own reason is what
    // stops the queue showing a ticket with an empty explanation.
    ...(verdict.event === 'lowConfidence|ambiguous' ? { reason: verdict.reason } : {}),
  });
  await deps.applyTransition(received.id, result);
  return `${received.id}: response ${response.id} → ${result.to}${verdict.event === 'lowConfidence|ambiguous' ? ` (${verdict.reason})` : ''}`;
}

type ProvenanceRawEntries = readonly {
  dataCategory: string;
  statedSource: string | null;
  statedLegalBasis: string | null;
  confidence: number;
}[];
