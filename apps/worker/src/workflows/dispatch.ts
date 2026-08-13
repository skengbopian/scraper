import {
  apply,
  PlaybookNotSendableError,
  renderRequest,
  type PartialErasureScope,
  type Playbook,
  type RequestSnapshot,
  type RequestSubject,
  type TransitionResult,
  type WorkflowEngine,
} from '@scraper/core';
import { HUMAN_QUEUE_REASON, humanQueue, type RecordHumanQueueEntry } from '../channels/human-queue.js';
import { eventFor, type SendOutcome } from '../channels/types.js';
import type { GatewaySendRequest, OutboundGateway } from '../gateway/controller-gateway.js';
import { planDispatch, type DispatchPlan } from './provenance.js';

/**
 * Dispatch of a READY request — port wave 5, re-derived (ADR-037).
 *
 * The channel/clock contract lives in `planDispatch()` (provenance.ts), which was already a pure
 * decision function and is built on rather than replaced. This file is the I/O shell around it:
 * render → dispatch → gateway → apply the send event the gateway's outcome maps to.
 *
 * What the pre-audit line's dispatch workflow did wrong is not visible here, which is the point: it
 * read `result.provable` and branched. There is no such field to read. The gateway returns a
 * discriminated `SendOutcome` and `eventFor()` is total over it, so "which clock starts" is decided
 * by the outcome's TYPE, not by a boolean any adapter could set.
 */

export interface DispatchableRequest {
  readonly snapshot: RequestSnapshot;
  readonly playbook: Playbook;
  /** Derived from the verified Identity. There is no free-typed subject anywhere (ADR-009). */
  readonly subject: RequestSubject;
  /** Non-null only when a real IdentityPacket was attached to THIS dispatch (audit C6). */
  readonly attachedIdentityPacketId: string | null;
  /** Required exactly when the playbook declares `scopeSource` (ADR-036). */
  readonly scope?: PartialErasureScope;
  /**
   * True when the user authorised the registered re-send, i.e. the request re-entered READY from
   * AWAITING_REGISTERED_RESEND. DERIVED from the event log by the adapter, never passed in by a
   * caller — a request body that could set this would be a way to force a €3–5 action.
   */
  readonly forceRegistered: boolean;
}

export interface DispatchDeps {
  readonly load: (requestId: string) => Promise<DispatchableRequest | null>;
  readonly readTemplate: (templateId: string) => Promise<string>;
  readonly gateway: OutboundGateway;
  readonly applyTransition: (requestId: string, result: TransitionResult) => Promise<void>;
  readonly recordHumanQueueEntry: RecordHumanQueueEntry;
  readonly engine: WorkflowEngine | null;
  readonly log: (message: string) => void;
  readonly now: () => Date;
}

/** Statutory default when a playbook does not name one (Art. 12(3): one month). */
const DEFAULT_DEADLINE_DAYS = 30;

export type PreparedDispatch =
  | { readonly kind: 'SEND'; readonly plan: DispatchPlan; readonly subject: string; readonly body: string; readonly deadlineDays: number }
  | { readonly kind: 'HUMAN_QUEUE'; readonly reason: string };

/**
 * Pure: decide the channel and render the letter, or explain why neither is possible.
 *
 * Two ways out to the human queue, and they are different failures:
 *   - `planDispatch` returns `humanQueue` for a web-form playbook (Phase 0 does not automate forms);
 *   - `renderRequest` THROWS for a playbook counsel has not signed off, an unattached identity
 *     packet, or a missing erasure scope. Every playbook in this repo is `active: false`, so today
 *     this is the branch every dispatch actually takes — and that is the counsel gate working, not a
 *     bug to route around. It must stay a caught throw rather than a check, so a new refusal reason
 *     added to the engine lands here automatically.
 */
export function prepareDispatch(
  row: DispatchableRequest,
  templateBody: string,
  now: Date,
): PreparedDispatch {
  let plan: DispatchPlan;
  try {
    plan = planDispatch(row.playbook, { forceRegistered: row.forceRegistered });
  } catch (e) {
    return { kind: 'HUMAN_QUEUE', reason: `${HUMAN_QUEUE_REASON.NO_PROVABLE_CHANNEL} (${(e as Error).message})` };
  }

  if (plan.expectedEvent === 'humanQueue') {
    return { kind: 'HUMAN_QUEUE', reason: `${HUMAN_QUEUE_REASON.WEB_FORM_NOT_AUTOMATED} ${plan.reason}` };
  }

  let body: string;
  try {
    body = renderRequest({
      playbook: row.playbook,
      templateBody,
      subject: row.subject,
      attachedIdentityPacketId: row.attachedIdentityPacketId,
      ...(row.scope ? { scope: row.scope } : {}),
      now,
    }).text;
  } catch (e) {
    if (!(e instanceof PlaybookNotSendableError)) throw e;
    return { kind: 'HUMAN_QUEUE', reason: `${HUMAN_QUEUE_REASON.PLAYBOOK_NOT_SENDABLE} (${e.message})` };
  }

  return {
    kind: 'SEND',
    plan,
    // TODO(counsel): subject-line wording belongs in a reviewed template. A neutral technical
    // reference until then — it is what a reply quotes, so it must be stable and non-legal.
    subject: `Datenschutzanfrage ${row.snapshot.id}`,
    body,
    deadlineDays: row.playbook.deadlineDays ?? DEFAULT_DEADLINE_DAYS,
  };
}

/** Handle a `dispatch` job for a READY request. */
export async function dispatchReadyRequest(deps: DispatchDeps, requestId: string): Promise<string> {
  const row = await deps.load(requestId);
  if (!row) return `skip: request ${requestId} not found`;
  if (row.snapshot.state !== 'READY') {
    // At-least-once delivery makes replays normal. Never double-dispatch.
    return `skip: ${requestId} is in ${row.snapshot.state}, not READY — dispatch job is stale`;
  }

  const templateBody = await deps.readTemplate(row.playbook.template).catch(() => null);
  const prepared =
    templateBody === null
      ? ({ kind: 'HUMAN_QUEUE', reason: `template ${row.playbook.template} could not be read` } as const)
      : prepareDispatch(row, templateBody, deps.now());

  if (prepared.kind === 'HUMAN_QUEUE') {
    // NOT a transition. The request never left READY, so there is nothing to undo and nothing to
    // record as sent — it simply waits for ops (see channels/human-queue.ts).
    await deps.recordHumanQueueEntry({ requestId, reason: prepared.reason, queuedAt: deps.now() });
    return `human queue: ${requestId} — ${prepared.reason}`;
  }

  // READY → SENT. From here the request has left our hands, so every later failure resolves to
  // NEEDS_HUMAN rather than to a retry that could put a second letter in the post.
  await deps.applyTransition(requestId, apply(row.snapshot, 'dispatch', { actor: 'SYSTEM', now: deps.now() }));
  const sentSnapshot: RequestSnapshot = { ...row.snapshot, state: 'SENT' };

  const outcome = await deps.gateway.send(gatewayRequest(row, prepared));
  return applySendOutcome(deps, sentSnapshot, outcome, prepared.deadlineDays);
}

function gatewayRequest(row: DispatchableRequest, prepared: Extract<PreparedDispatch, { kind: 'SEND' }>): GatewaySendRequest {
  return {
    requestId: row.snapshot.id,
    userId: row.snapshot.userId,
    controllerId: row.snapshot.controllerId,
    requestType: row.snapshot.requestType,
    // planDispatch never returns web_form here — that path exited to the human queue above.
    channel: prepared.plan.channel === 'postal' ? 'postal' : 'email',
    registered: prepared.plan.registered,
    recipient: prepared.plan.recipient,
    subject: prepared.subject,
    body: prepared.body,
  };
}

/**
 * Map the gateway's outcome onto the state machine, and arm the matching timer.
 *
 * The two clocks are armed from the SAME place so they cannot drift: whichever event was applied
 * determines which deadline field the transition wrote, and the timer follows that field. There is
 * no branch here that reads a channel name.
 */
export async function applySendOutcome(
  deps: DispatchDeps,
  sent: RequestSnapshot,
  outcome: SendOutcome,
  deadlineDays: number,
): Promise<string> {
  const event = eventFor(outcome);
  if (event === null) {
    await deps.recordHumanQueueEntry({ requestId: sent.id, reason: outcome.kind === 'HUMAN_QUEUE' ? outcome.reason : '', queuedAt: deps.now() });
    return `human queue: ${sent.id}`;
  }

  const now = deps.now();
  const result = apply(sent, event, {
    actor: 'SYSTEM',
    now,
    deadlineDays,
    ...(outcome.kind === 'DELIVERY_PROVEN' ? { provableSendEvidenceId: outcome.evidenceId } : {}),
    ...(outcome.kind === 'FAILED' ? { reason: outcome.reason } : {}),
  });
  await deps.applyTransition(sent.id, result);

  if (result.patch.deadlineAt) {
    await schedule(deps, sent.id, 'statutory', result.patch.deadlineAt);
    return `${sent.id}: provable send confirmed → AWAITING_RESPONSE, Art. 12(3) clock to ${result.patch.deadlineAt.toISOString()}`;
  }
  if (result.patch.provisionalDeadlineAt) {
    await schedule(deps, sent.id, 'provisional', result.patch.provisionalDeadlineAt);
    return `${sent.id}: non-provable send → AWAITING_RESPONSE_PROVISIONAL, provisional hint to ${result.patch.provisionalDeadlineAt.toISOString()} (NOT a statutory deadline)`;
  }
  return `${sent.id}: send failed → NEEDS_HUMAN (${outcome.kind === 'FAILED' ? outcome.reason : outcome.kind})`;
}

async function schedule(deps: DispatchDeps, requestId: string, kind: 'provisional' | 'statutory', at: Date): Promise<void> {
  if (!deps.engine) {
    deps.log(`no workflow engine configured — ${kind} deadline for ${requestId} is NOT armed`);
    return;
  }
  // The timestamp is part of the key: a re-sent request gets a fresh timer rather than colliding
  // with the spent one (which pg-boss would dedupe into a silent no-op).
  await deps.engine.schedule(`deadline:${requestId}:${kind}:${at.getTime()}`, at, {
    name: 'deadline-expiry',
    payload: { requestId, kind },
  });
}

export { humanQueue };
