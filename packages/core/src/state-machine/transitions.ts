import type { Actor, RequestState } from './states.js';

/**
 * The transition table. Single source of truth for the graph — the guards in `machine.ts` read it,
 * and the tests assert graph properties over it rather than over hand-written expectations.
 *
 * `requiredActor` is what makes "an auto-sent Art. 77 complaint is unrepresentable" true rather than
 * merely documented: `humanSend` is the only edge into ESCALATED and it demands HUMAN_OPS, so no
 * SYSTEM-driven code path can reach that state regardless of what a workflow decides to call.
 */
export interface Transition {
  readonly from: RequestState;
  readonly event: string;
  readonly to: RequestState;
  /** If set, the transition is rejected unless the acting principal matches. */
  readonly requiredActor?: Actor;
  /** Human-readable reason, surfaced in errors and in the audit trail. */
  readonly note?: string;
}

export const TRANSITIONS: readonly Transition[] = Object.freeze([
  { from: 'DRAFT', event: 'guardFail(identity)', to: 'BLOCKED_IDENTITY' },
  { from: 'DRAFT', event: 'guardFail(idempotency|mandate)', to: 'CLOSED_FAILED' },
  { from: 'DRAFT', event: 'guardsPass', to: 'READY' },

  { from: 'BLOCKED_IDENTITY', event: 'identityVerified:guardsPass', to: 'READY' },
  { from: 'BLOCKED_IDENTITY', event: 'identityVerified:guardFail', to: 'CLOSED_FAILED' },

  { from: 'READY', event: 'dispatch', to: 'SENT' },

  {
    from: 'SENT',
    event: 'provableSendConfirmed',
    to: 'AWAITING_RESPONSE',
    note: 'sets deadlineAt — the ONLY edge that may do so',
  },
  {
    from: 'SENT',
    event: 'sendAccepted:nonProvable',
    to: 'AWAITING_RESPONSE_PROVISIONAL',
    note: 'sets provisionalDeadlineAt; deadlineAt stays null',
  },
  { from: 'SENT', event: 'sendPermanentlyFailed', to: 'NEEDS_HUMAN' },

  { from: 'AWAITING_RESPONSE_PROVISIONAL', event: 'responseIngested', to: 'RESPONSE_RECEIVED' },
  { from: 'AWAITING_RESPONSE_PROVISIONAL', event: 'provisionalDeadlineExpired', to: 'AWAITING_REGISTERED_RESEND' },

  {
    from: 'AWAITING_REGISTERED_RESEND',
    event: 'userConfirmsResend:guardsPass',
    to: 'READY',
    requiredActor: 'USER',
    note: 'the registered re-send is a paid action and an escalation step — the user owns it',
  },
  { from: 'AWAITING_REGISTERED_RESEND', event: 'responseIngested', to: 'RESPONSE_RECEIVED' },
  {
    from: 'AWAITING_REGISTERED_RESEND',
    event: 'userDeclinesResend',
    to: 'CLOSED_FAILED',
    requiredActor: 'USER',
    note: 'outcome = NO_PROVABLE_CLOCK; excluded from controller stats',
  },

  { from: 'AWAITING_RESPONSE', event: 'responseIngested', to: 'RESPONSE_RECEIVED' },
  {
    from: 'AWAITING_RESPONSE',
    event: 'deadlineExpired',
    to: 'ESCALATION_DRAFTED',
    note: 'the silence path — structurally reachable only after provableSendConfirmed',
  },

  { from: 'RESPONSE_RECEIVED', event: 'validated:complied', to: 'COMPLIED' },
  { from: 'RESPONSE_RECEIVED', event: 'validated:incomplete', to: 'INCOMPLETE' },
  { from: 'RESPONSE_RECEIVED', event: 'validated:refused', to: 'REFUSED' },
  { from: 'RESPONSE_RECEIVED', event: 'lowConfidence|ambiguous', to: 'NEEDS_HUMAN' },

  { from: 'NEEDS_HUMAN', event: 'humanResolve:complied', to: 'COMPLIED', requiredActor: 'HUMAN_OPS' },
  { from: 'NEEDS_HUMAN', event: 'humanResolve:incomplete', to: 'INCOMPLETE', requiredActor: 'HUMAN_OPS' },
  { from: 'NEEDS_HUMAN', event: 'humanResolve:refused', to: 'REFUSED', requiredActor: 'HUMAN_OPS' },
  {
    from: 'NEEDS_HUMAN',
    event: 'humanResolve:escalate',
    to: 'ESCALATION_DRAFTED',
    requiredActor: 'HUMAN_OPS',
    note: 'invariant 3b: also requires proven receipt — see machine.ts',
  },
  { from: 'NEEDS_HUMAN', event: 'humanResolve:resend', to: 'READY', requiredActor: 'HUMAN_OPS' },

  { from: 'INCOMPLETE', event: 'escalate', to: 'ESCALATION_DRAFTED' },
  { from: 'INCOMPLETE', event: 'responseIngested', to: 'RESPONSE_RECEIVED' },
  { from: 'REFUSED', event: 'escalate', to: 'ESCALATION_DRAFTED' },
  { from: 'REFUSED', event: 'responseIngested', to: 'RESPONSE_RECEIVED' },

  {
    from: 'ESCALATION_DRAFTED',
    event: 'humanSend',
    to: 'ESCALATED',
    requiredActor: 'HUMAN_OPS',
    note: 'THE ONLY EDGE INTO ESCALATED. CLAUDE.md §5 / docs/06. Do not add a second.',
  },
  { from: 'ESCALATION_DRAFTED', event: 'humanDiscard', to: 'CLOSED_FAILED', requiredActor: 'HUMAN_OPS' },
  { from: 'ESCALATION_DRAFTED', event: 'responseIngested', to: 'RESPONSE_RECEIVED' },

  { from: 'ESCALATED', event: 'responseIngested', to: 'RESPONSE_RECEIVED' },
  { from: 'ESCALATED', event: 'resolved:complied', to: 'COMPLIED' },
  { from: 'ESCALATED', event: 'resolved:failed', to: 'CLOSED_FAILED' },
]);

/** `(any non-terminal) --userWithdraw|mandateRevoked--> WITHDRAWN` from the spec. */
export const WITHDRAW_EVENT = 'userWithdraw|mandateRevoked';
