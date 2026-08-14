import type { ProvableSendEvidenceId } from '../evidence/provable-send.js';
import { COUNTS_TOWARD_COMPLIANCE_STATS, isTerminal, type Actor, type Outcome, type RequestState } from './states.js';
import { statutoryDeadlineAt } from './statutory-clock.js';
import { TRANSITIONS, WITHDRAW_EVENT, type Transition } from './transitions.js';

/**
 * The state machine. Every transition goes through `apply()`; there is no setter for `state`.
 *
 * Guards here implement the invariants in `schema/request-state-machine.md` that the graph alone
 * cannot express. Where an invariant IS structural, the code says so rather than re-checking it —
 * duplicating a structural guarantee as a runtime `if` invites someone to relax the `if` later and
 * believe the structure still holds.
 */

/**
 * How long we wait for a carrier's delivery receipt before asking a human.
 *
 * TODO(counsel): 14 days is an operational guess, not a legal figure. Deutsche Post's
 * Einwurf-Einschreiben receipt is retrievable for a bounded window; the right number is whatever the
 * chosen carrier's retention is, minus our own processing slack. Nothing legal keys off it — it only
 * decides when `proofRetrievalFailed` puts the request in front of a person.
 */
export const PROOF_RETRIEVAL_WINDOW_DAYS = 14;

export interface RequestSnapshot {
  readonly id: string;
  readonly state: RequestState;
  readonly userId: string;
  readonly controllerId: string;
  readonly requestType: string;
  /** Non-null only after a provable (registered + QTSP-anchored) send. */
  readonly provableSendConfirmedAt: Date | null;
  /** The Art. 12(3) clock. Non-null only if provableSendConfirmedAt is non-null. */
  readonly deadlineAt: Date | null;
  /** Operational scheduling hint from a non-provable send. NEVER a statutory deadline. */
  readonly provisionalDeadlineAt: Date | null;
  /**
   * When to stop waiting for a carrier's delivery receipt and ask a human. Set on a registered
   * LODGEMENT and non-null only in AWAITING_DELIVERY_PROOF. Weaker than `provisionalDeadlineAt`:
   * that one at least measures time since something reached the wire, this one only measures our own
   * patience with a vendor. It is never a deadline of any kind.
   */
  readonly proofDueAt: Date | null;
  readonly hasControllerResponse: boolean;
  readonly reviewedByHuman: boolean;
  readonly parseConfidence: number | null;
  readonly humanReviewIfConfidenceBelow: number;
  readonly outcome: Outcome | null;
}

export interface TransitionContext {
  readonly actor: Actor;
  readonly now: Date;
  /** Set on sends. */
  readonly deadlineDays?: number;
  /**
   * Set on `provableSendConfirmed` — the QTSP-anchored evidence record proving delivery.
   *
   * BRANDED, and the brand is the guard. This used to be a `string`, which meant any string — a
   * request id, a provider reference, `'stub:einwurf-proof-1'` — satisfied invariant 2's check. The
   * only constructor is `provableSendEvidenceIdOf()`, which requires a carrier-issued receipt
   * anchored at a real QTSP. A simulated proof is now a COMPILE error at every call site and a
   * throw at the one place ids are made, rather than a runtime `if` someone can relax later.
   */
  readonly provableSendEvidenceId?: ProvableSendEvidenceId;
  /**
   * When the carrier's receipt says the letter was DELIVERED — `DeliveryProof.deliveredAt`.
   *
   * Art. 12(3) runs from receipt of the request, so this is what the calendar month is measured from.
   * It matters because the confirming event can arrive long after delivery: on the asynchronous path
   * `ctx.now` is when our retrieval job fetched the receipt, and dating the month from THAT would
   * hand the controller however many days our queue happened to be behind — the user's statutory
   * time, given away by a scheduling detail. Required on the asynchronous edge (see `apply()`);
   * optional from SENT, where the receipt was already in hand when the send returned.
   */
  readonly deliveredAt?: Date;
  readonly reason?: string;
}

export interface TransitionResult {
  readonly from: RequestState;
  readonly to: RequestState;
  readonly event: string;
  readonly actor: Actor;
  readonly at: Date;
  /** Field mutations the caller must persist atomically with the state change. */
  readonly patch: Partial<{
    deadlineAt: Date | null;
    provisionalDeadlineAt: Date | null;
    proofDueAt: Date | null;
    provableSendConfirmedAt: Date | null;
    outcome: Outcome | null;
    closedAt: Date | null;
  }>;
  readonly note?: string;
  /**
   * The caller's `ctx.reason`, carried through so it reaches the RequestEvent payload.
   *
   * It used to stop at `apply()`, which meant a `sendPermanentlyFailed` transition recorded THAT a
   * send failed and never WHY. The ops queue then showed a ticket with an empty reason column — a
   * human asked to decide with the one fact that would inform the decision missing. Invariant 7 says
   * every transition writes an event; an event that drops the reason satisfies the letter of that
   * and not the point.
   */
  readonly reason?: string;
}

export class IllegalTransitionError extends Error {
  constructor(from: RequestState, event: string, detail?: string) {
    super(`Illegal transition: no edge "${event}" from ${from}${detail ? ` — ${detail}` : ''}`);
    this.name = 'IllegalTransitionError';
  }
}

export class GuardViolationError extends Error {
  constructor(public readonly guard: string, message: string) {
    super(`Guard "${guard}" rejected the transition: ${message}`);
    this.name = 'GuardViolationError';
  }
}

/**
 * The persistence layer refused a transition because the row's state no longer matches the snapshot
 * the transition was computed from — another actor moved the request first (worker sweep vs. queued
 * job, a double-submitted user action, two ops reviewers on one ticket). Every repository MUST
 * compare-and-swap on the from-state when persisting: a blind write would record a second
 * READY→SENT in the append-only log and let both racers reach the wire (CLAUDE.md §8 — a duplicate
 * legal request risks being deemed excessive under Art. 12(5)). The loser surfaces this error and
 * re-loads; it never overwrites.
 */
export class StaleTransitionError extends Error {
  constructor(public readonly requestId: string, public readonly expectedFrom: RequestState, detail?: string) {
    super(`Stale transition: request ${requestId} is no longer in ${expectedFrom}${detail ? ` — ${detail}` : ''}`);
    this.name = 'StaleTransitionError';
  }
}

function findEdge(from: RequestState, event: string): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.event === event);
}

export function allowedEvents(from: RequestState): string[] {
  const evts = TRANSITIONS.filter((t) => t.from === from).map((t) => t.event);
  if (!isTerminal(from)) evts.push(WITHDRAW_EVENT);
  return evts;
}

/** Outcome implied by arriving at a terminal state via a given event. */
function outcomeFor(event: string, to: RequestState, req: RequestSnapshot, now: Date): Outcome | null {
  if (to === 'COMPLIED') return 'COMPLIED';
  if (to === 'WITHDRAWN') return 'WITHDRAWN';
  if (event === 'userDeclinesResend') return 'NO_PROVABLE_CLOCK';
  if (to === 'CLOSED_FAILED') {
    // Provable silence must reach the census. A statutory clock that ran out with no controller
    // reply on file is the worst controller behaviour the two-clock machinery exists to evidence —
    // and before this branch existed, `NO_RESPONSE` was returned by nothing, so total silence on a
    // provable month could never be recorded against a controller (audit F2). The discard/failure
    // of the ESCALATION that silence produced does not change what the controller did.
    const provableSilence =
      req.deadlineAt !== null && req.deadlineAt.getTime() <= now.getTime() && !req.hasControllerResponse;
    if (provableSilence && (event === 'humanDiscard' || event === 'resolved:failed')) return 'NO_RESPONSE';
    return 'ABANDONED';
  }
  return null;
}

export function apply(req: RequestSnapshot, event: string, ctx: TransitionContext): TransitionResult {
  // `(any non-terminal) --userWithdraw|mandateRevoked--> WITHDRAWN`
  if (event === WITHDRAW_EVENT) {
    if (isTerminal(req.state)) {
      throw new IllegalTransitionError(req.state, event, 'request is already terminal');
    }
    return {
      from: req.state,
      to: 'WITHDRAWN',
      event,
      actor: ctx.actor,
      at: ctx.now,
      patch: {
        outcome: 'WITHDRAWN',
        closedAt: ctx.now,
        // A withdrawal from AWAITING_DELIVERY_PROOF spends the retrieval hint like any other exit.
        ...(req.state === 'AWAITING_DELIVERY_PROOF' ? { proofDueAt: null } : {}),
      },
      ...(ctx.reason ? { reason: ctx.reason } : {}),
    };
  }

  const edge = findEdge(req.state, event);
  if (!edge) {
    throw new IllegalTransitionError(req.state, event, `allowed: ${allowedEvents(req.state).join(', ')}`);
  }

  if (edge.requiredActor && ctx.actor !== edge.requiredActor) {
    throw new GuardViolationError(
      'actor',
      `"${event}" requires actor ${edge.requiredActor} but was attempted by ${ctx.actor}. ` +
        (edge.to === 'ESCALATED'
          ? 'An Art. 77 complaint may only be sent by a human (CLAUDE.md §5).'
          : ''),
    );
  }

  const patch: TransitionResult['patch'] = {};

  // --- Invariant 2: the clock is provable. -----------------------------------------------------
  // deadlineAt is set here and NOWHERE else. Email/web-form sends land on the sibling edge and get
  // provisionalDeadlineAt, which is a scheduling hint with no legal force.
  if (event === 'provableSendConfirmed') {
    if (!ctx.provableSendEvidenceId) {
      throw new GuardViolationError(
        'provableSend',
        'provableSendConfirmed requires a QTSP-anchored evidence record id proving delivery. ' +
          'Without it this is not a provable send and must use sendAccepted:nonProvable ' +
          '(CLAUDE.md §6, docs/05 §6). Mint the id with provableSendEvidenceIdOf(); there is no ' +
          'other constructor, and deliberately no simulated one.',
      );
    }
    // ASYNCHRONOUS CONFIRMATION (audit F3a). Coming from AWAITING_DELIVERY_PROOF, `ctx.now` is when
    // the retrieval job ran, which has nothing to do with when the letter was delivered. Requiring
    // `deliveredAt` on exactly that edge is what stops a queue backlog from silently extending the
    // controller's month; from SENT the receipt was already in hand, so `now` is the delivery time
    // and the field stays optional.
    if (req.state === 'AWAITING_DELIVERY_PROOF' && !ctx.deliveredAt) {
      throw new GuardViolationError(
        'deliveredAt',
        'confirming a provable send from AWAITING_DELIVERY_PROOF requires ctx.deliveredAt — the time ' +
          "the carrier's receipt evidences DELIVERY. Dating the Art. 12(3) month from when we fetched " +
          'the receipt would hand the controller our queue latency as extra statutory time.',
      );
    }
    const deliveredAt = ctx.deliveredAt ?? ctx.now;
    if (deliveredAt.getTime() > ctx.now.getTime()) {
      throw new GuardViolationError(
        'deliveredAt',
        `the delivery receipt claims delivery at ${deliveredAt.toISOString()}, which is after now ` +
          `(${ctx.now.toISOString()}). A receipt cannot evidence a future delivery; treat this as a ` +
          'corrupt or misparsed proof and route it to a human.',
      );
    }
    patch.provableSendConfirmedAt = deliveredAt;
    // Art. 12(3) is one CALENDAR month (Reg. 1182/71 / EDPB Guidelines 01/2022 §54) from RECEIPT of
    // the request: same-numbered day next month, clamped to month end, extended over
    // Sat/Sun/bundesweite Feiertage, expiring at Europe/Berlin end of day. `deadlineDays × 24h`
    // fired up to a day early on 31-day months — an escalation draft alleging silence while the
    // controller legally had time left. `ctx.deadlineDays` parameterises only the PROVISIONAL hint.
    patch.deadlineAt = statutoryDeadlineAt(deliveredAt);
    // The hint is spent: leaving it beside the statutory clock showed a stale provisional date in
    // the ops queue (audit F7). The UI already prefers the statutory clock; the row should agree.
    patch.provisionalDeadlineAt = null;
  }

  // A registered LODGEMENT starts nothing. Einlieferung is not Zustellung: the carrier has the
  // letter, and until the Auslieferungsbeleg comes back nothing is evidenced — not a statutory
  // month, and not even the weaker provisional hint, because there is no chase to schedule (the
  // registered send the chase would ask for has already happened).
  if (event === 'registeredSendLodged') {
    patch.deadlineAt = null;
    patch.provisionalDeadlineAt = null;
    patch.proofDueAt = new Date(ctx.now.getTime() + PROOF_RETRIEVAL_WINDOW_DAYS * 86_400_000);
  }

  // Leaving AWAITING_DELIVERY_PROOF spends the retrieval hint, whichever way we leave. A stale
  // proofDueAt sitting beside a running statutory clock is the audit-F7 confusion again.
  if (req.state === 'AWAITING_DELIVERY_PROOF') patch.proofDueAt = null;

  if (event === 'sendAccepted:nonProvable') {
    if (!ctx.deadlineDays) throw new GuardViolationError('send', 'deadlineDays is required');
    patch.provisionalDeadlineAt = new Date(ctx.now.getTime() + ctx.deadlineDays * 86_400_000);
    patch.deadlineAt = null; // explicit: a non-provable send must never leave a stale clock behind
  }

  // --- Invariant 5: the parser cannot decide alone. --------------------------------------------
  if (event.startsWith('validated:')) {
    // A non-numeric floor means the playbook document never passed the gate that guarantees one —
    // fail closed to the strictest floor rather than letting `x < undefined === false` disable the
    // guard (audit P1).
    const floor = typeof req.humanReviewIfConfidenceBelow === 'number' ? req.humanReviewIfConfidenceBelow : 1;
    const belowThreshold = req.parseConfidence !== null && req.parseConfidence < floor;
    if (belowThreshold && !req.reviewedByHuman) {
      throw new GuardViolationError(
        'parserConfidence',
        `parse confidence ${req.parseConfidence} is below the playbook's ` +
          `humanReviewIfConfidenceBelow (${req.humanReviewIfConfidenceBelow}) and no human has reviewed it. ` +
          `The only permitted target is NEEDS_HUMAN (docs/06 C4). A controller document is hostile input.`,
      );
    }
  }

  // --- Invariant 4: escalation rests on proven receipt. -----------------------------------------
  // 4a (silence) is STRUCTURAL: `deadlineExpired` exists only on AWAITING_RESPONSE, which is only
  // reachable via provableSendConfirmed. It is deliberately not re-checked here.
  // 4b is this: humanResolve:escalate is reachable from a sendPermanentlyFailed entry into
  // NEEDS_HUMAN, where nothing proves the controller ever received anything.
  if (event === 'humanResolve:escalate') {
    if (req.provableSendConfirmedAt === null && !req.hasControllerResponse) {
      throw new GuardViolationError(
        'provenReceipt',
        'cannot draft an Art. 77 complaint: there is neither a provable send nor a controller response, ' +
          'so nothing establishes that the controller ever received the request. Authorise a registered ' +
          're-send first (state machine, invariant 4b).',
      );
    }
  }

  const outcome = outcomeFor(event, edge.to, req, ctx.now);
  if (outcome) patch.outcome = outcome;
  if (isTerminal(edge.to)) patch.closedAt = ctx.now;

  return {
    from: req.state, to: edge.to, event, actor: ctx.actor, at: ctx.now, patch, note: edge.note,
    ...(ctx.reason ? { reason: ctx.reason } : {}),
  };
}

/** Does this finished request count toward the controller's published compliance record? */
export function countsTowardControllerStats(outcome: Outcome | null): boolean {
  return outcome !== null && COUNTS_TOWARD_COMPLIANCE_STATS[outcome];
}
