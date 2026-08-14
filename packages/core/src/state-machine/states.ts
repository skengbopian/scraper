/**
 * RightsRequest states, transcribed from `schema/request-state-machine.md`.
 *
 * That document is normative. `test/spec-sync.test.ts` parses it and asserts this file matches, so
 * the spec and the implementation cannot drift apart silently — which is the failure mode the whole
 * pre-code spec pass existed to prevent.
 */

export const STATES = [
  'DRAFT',
  'BLOCKED_IDENTITY',
  'READY',
  'SENT',
  'AWAITING_DELIVERY_PROOF',
  'AWAITING_RESPONSE_PROVISIONAL',
  'AWAITING_RESPONSE',
  'AWAITING_REGISTERED_RESEND',
  'RESPONSE_RECEIVED',
  'NEEDS_HUMAN',
  'COMPLIED',
  'INCOMPLETE',
  'REFUSED',
  'ESCALATION_DRAFTED',
  'ESCALATED',
  'CLOSED_FAILED',
  'WITHDRAWN',
] as const;

export type RequestState = (typeof STATES)[number];

export const TERMINAL_STATES = ['COMPLIED', 'CLOSED_FAILED', 'WITHDRAWN'] as const satisfies readonly RequestState[];
export type TerminalState = (typeof TERMINAL_STATES)[number];

export function isTerminal(s: RequestState): s is TerminalState {
  return (TERMINAL_STATES as readonly string[]).includes(s);
}

/**
 * The statutory clock has started only in AWAITING_RESPONSE. Everything else that looks like
 * "waiting" is a provisional clock with no legal force (CLAUDE.md §6) — or, in
 * AWAITING_DELIVERY_PROOF, no clock at all: a letter lodged with a carrier whose receipt has not come
 * back yet is not evidence of anything, so nothing may be counted from it.
 */
export function hasProvableClock(s: RequestState): boolean {
  return s === 'AWAITING_RESPONSE';
}

/**
 * `outcome` is set on reaching a terminal state and is what per-controller statistics aggregate.
 * See the outcome table in `schema/request-state-machine.md`.
 */
export const OUTCOMES = [
  'COMPLIED',
  'INCOMPLETE',
  'REFUSED',
  'NO_RESPONSE',
  'NO_PROVABLE_CLOCK',
  'WITHDRAWN',
  'ABANDONED',
] as const;

export type Outcome = (typeof OUTCOMES)[number];

/**
 * Which outcomes may be counted against a controller's compliance record.
 *
 * NO_PROVABLE_CLOCK is excluded deliberately: the user declined the registered re-send, so no
 * statutory clock ever ran and the controller's silence is not evidence of non-compliance. docs/05 §7
 * publishes these numbers as self-evidenced fact, which makes an over-counted denominator a
 * defamation exposure rather than a reporting bug.
 */
export const COUNTS_TOWARD_COMPLIANCE_STATS: Readonly<Record<Outcome, boolean>> = Object.freeze({
  COMPLIED: true,
  INCOMPLETE: true,
  REFUSED: true,
  NO_RESPONSE: true,
  NO_PROVABLE_CLOCK: false,
  WITHDRAWN: false,
  ABANDONED: false,
});

export type Actor = 'SYSTEM' | 'USER' | 'HUMAN_OPS';
