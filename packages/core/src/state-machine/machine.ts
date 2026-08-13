import type { ProvableSendEvidenceId } from '../evidence/provable-send.js';
import { COUNTS_TOWARD_COMPLIANCE_STATS, isTerminal, type Actor, type Outcome, type RequestState } from './states.js';
import { TRANSITIONS, WITHDRAW_EVENT, type Transition } from './transitions.js';

/**
 * The state machine. Every transition goes through `apply()`; there is no setter for `state`.
 *
 * Guards here implement the invariants in `schema/request-state-machine.md` that the graph alone
 * cannot express. Where an invariant IS structural, the code says so rather than re-checking it —
 * duplicating a structural guarantee as a runtime `if` invites someone to relax the `if` later and
 * believe the structure still holds.
 */

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

function findEdge(from: RequestState, event: string): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.event === event);
}

export function allowedEvents(from: RequestState): string[] {
  const evts = TRANSITIONS.filter((t) => t.from === from).map((t) => t.event);
  if (!isTerminal(from)) evts.push(WITHDRAW_EVENT);
  return evts;
}

/** Outcome implied by arriving at a terminal state via a given event. */
function outcomeFor(event: string, to: RequestState): Outcome | null {
  if (to === 'COMPLIED') return 'COMPLIED';
  if (to === 'WITHDRAWN') return 'WITHDRAWN';
  if (event === 'userDeclinesResend') return 'NO_PROVABLE_CLOCK';
  if (to === 'CLOSED_FAILED') return 'ABANDONED';
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
      patch: { outcome: 'WITHDRAWN', closedAt: ctx.now },
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
    if (!ctx.deadlineDays) throw new GuardViolationError('provableSend', 'deadlineDays is required to set the clock');
    patch.provableSendConfirmedAt = ctx.now;
    patch.deadlineAt = new Date(ctx.now.getTime() + ctx.deadlineDays * 86_400_000);
  }

  if (event === 'sendAccepted:nonProvable') {
    if (!ctx.deadlineDays) throw new GuardViolationError('send', 'deadlineDays is required');
    patch.provisionalDeadlineAt = new Date(ctx.now.getTime() + ctx.deadlineDays * 86_400_000);
    patch.deadlineAt = null; // explicit: a non-provable send must never leave a stale clock behind
  }

  // --- Invariant 5: the parser cannot decide alone. --------------------------------------------
  if (event.startsWith('validated:')) {
    const belowThreshold =
      req.parseConfidence !== null && req.parseConfidence < req.humanReviewIfConfidenceBelow;
    if (belowThreshold && !req.reviewedByHuman) {
      throw new GuardViolationError(
        'parserConfidence',
        `parse confidence ${req.parseConfidence} is below the playbook's ` +
          `humanReviewIfConfidenceBelow (${req.humanReviewIfConfidenceBelow}) and no human has reviewed it. ` +
          `The only permitted target is NEEDS_HUMAN (docs/06 C4). A controller document is hostile input.`,
      );
    }
  }

  // --- Invariant 4/3b: escalation rests on proven receipt. --------------------------------------
  // 3a (silence) is STRUCTURAL: `deadlineExpired` exists only on AWAITING_RESPONSE, which is only
  // reachable via provableSendConfirmed. It is deliberately not re-checked here.
  // 3b is this: humanResolve:escalate is reachable from a sendPermanentlyFailed entry into
  // NEEDS_HUMAN, where nothing proves the controller ever received anything.
  if (event === 'humanResolve:escalate') {
    if (req.provableSendConfirmedAt === null && !req.hasControllerResponse) {
      throw new GuardViolationError(
        'provenReceipt',
        'cannot draft an Art. 77 complaint: there is neither a provable send nor a controller response, ' +
          'so nothing establishes that the controller ever received the request. Authorise a registered ' +
          're-send first (state machine, invariant 3b).',
      );
    }
  }

  const outcome = outcomeFor(event, edge.to);
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
