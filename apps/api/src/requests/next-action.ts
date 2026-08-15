import type { RequestState } from '@scraper/core';

/**
 * The state → "what happens next" vocabulary the request view exposes (`nextAction`).
 *
 * docs/09 usability gate: every state names the user's next action, no dead ends. That gate was
 * enforced by a hand-maintained map inside `requests.service.ts` that covered 16 of the 17 states in
 * `packages/core/src/state-machine/states.ts` and threw on the seventeenth — so `GET /requests` and
 * `GET /requests/:id` returned 500 for any request parked by a registered lodgement. That is the one
 * path to an Art. 12(3) clock (CLAUDE.md §6): the states most worth showing a user were the states
 * the list could not render.
 *
 * The map lives here, next to nothing else, for one reason: `satisfies Record<RequestState, ...>`
 * makes a missing state a COMPILE error and an unknown key a compile error too. Adding a state to
 * `STATES` without naming its next action now fails `pnpm -r build`, not a user's request list.
 * `test/next-action.test.ts` re-checks the same property at runtime against the shipped `STATES`
 * array, because the compile-time guarantee only binds if both sides are built from the same source.
 */
export const NEXT_ACTION_BY_STATE = {
  DRAFT: 'AWAIT_VALIDATION',
  BLOCKED_IDENTITY: 'START_IDENTITY_VERIFICATION',
  READY: 'AWAIT_DISPATCH',
  SENT: 'AWAIT_SEND_CONFIRMATION',
  /**
   * The letter is with the carrier and only the Auslieferungsbeleg is outstanding. Nothing is asked
   * of the user: the receipt arrives from the retrieval job, or an ops human records it from the
   * paper original, and a receipt that never arrives goes to a human rather than to an escalation
   * (CLAUDE.md §6). "Wait" is the honest next action, and it is emphatically not AWAIT_REPLY — no
   * clock of any kind runs here, so nothing about a reply is yet due.
   */
  AWAITING_DELIVERY_PROOF: 'AWAIT_DELIVERY_PROOF',
  AWAITING_RESPONSE_PROVISIONAL: 'AWAIT_REPLY',
  AWAITING_RESPONSE: 'AWAIT_REPLY',
  AWAITING_REGISTERED_RESEND: 'CONFIRM_REGISTERED_RESEND',
  RESPONSE_RECEIVED: 'AWAIT_VALIDATION',
  NEEDS_HUMAN: 'AWAIT_OPS_REVIEW',
  COMPLIED: 'NONE',
  INCOMPLETE: 'AWAIT_ESCALATION_DRAFT',
  REFUSED: 'AWAIT_ESCALATION_DRAFT',
  ESCALATION_DRAFTED: 'AWAIT_OPS_SEND',
  ESCALATED: 'AWAIT_DPA_RESPONSE',
  CLOSED_FAILED: 'NONE',
  WITHDRAWN: 'NONE',
} as const satisfies Record<RequestState, string>;

export type NextAction = (typeof NEXT_ACTION_BY_STATE)[RequestState];

/**
 * Resolve a state's next action.
 *
 * The parameter is `RequestState`, so a caller inside the type system cannot miss. The runtime guard
 * survives for the one caller that is outside it — a state string read back from a database row,
 * which is a cast, not a proof. Corruption there stays loud rather than rendering as "NONE": a row
 * whose state is not in `STATES` is a defect to surface, not a screen to draw.
 */
export function nextActionFor(state: RequestState): NextAction {
  const next = NEXT_ACTION_BY_STATE[state] as NextAction | undefined;
  if (!next) throw new Error(`no next action defined for state ${state} — every state must name one`);
  return next;
}
