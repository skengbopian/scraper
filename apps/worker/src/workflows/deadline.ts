import { apply, type RequestSnapshot, type TransitionResult } from '@scraper/core';

/**
 * Deadline expiry — TWO paths, not one (port wave 5, ADR-037).
 *
 * The pre-audit line has a single expiry path: `AWAITING_RESPONSE` past `deadlineAt` →
 * `deadlineExpired` → draft an Art. 77 complaint. That is coherent in a 13-state machine where an
 * email started the statutory clock, and catastrophic here: the same code applied to a provisional
 * deadline would found a DPA complaint on a deadline that was never legally established.
 *
 * So the two clocks expire into two different places, and the difference is legal, not cosmetic:
 *
 *   provisional expiry → AWAITING_REGISTERED_RESEND
 *       Nothing proves the controller received anything. The USER is asked to authorise a registered
 *       re-send, which starts a FRESH Art. 12(3) month (ADR-012). Not an escalation; a chase.
 *
 *   statutory expiry   → ESCALATION_DRAFTED
 *       A provable send is on the record and the month has run in silence. This is the only silence
 *       path to an Art. 77 complaint, and it is DRAFTED — the humanSend edge into ESCALATED requires
 *       HUMAN_OPS and lives on the ops surface, not here (ADR-008).
 *
 * Invariant 3a makes the separation structural rather than a runtime check: `deadlineExpired` exists
 * ONLY on AWAITING_RESPONSE, which is reachable ONLY via `provableSendConfirmed`. The state guard
 * below is therefore a staleness filter, not the safety mechanism — if it were deleted, `apply()`
 * would still refuse, and `tools/spec-audit/statemachine.mjs` asserts the forbidden path is absent.
 */

export interface DeadlinePayload {
  readonly requestId: string;
  readonly kind: 'provisional' | 'statutory';
}

export interface DeadlineDeps {
  readonly load: (requestId: string) => Promise<RequestSnapshot | null>;
  readonly applyTransition: (requestId: string, result: TransitionResult) => Promise<void>;
  readonly now: () => Date;
}

/**
 * The state a given expiry kind may fire from. A table rather than an if-chain so that adding a
 * third clock without deciding where it expires to is a type error.
 */
const EXPIRY: Readonly<Record<DeadlinePayload['kind'], { readonly from: RequestSnapshot['state']; readonly event: string; readonly note: string }>> =
  Object.freeze({
    provisional: {
      from: 'AWAITING_RESPONSE_PROVISIONAL',
      event: 'provisionalDeadlineExpired',
      note: 'the chase step — the USER decides about the registered re-send (ADR-012). No complaint is drafted.',
    },
    statutory: {
      from: 'AWAITING_RESPONSE',
      event: 'deadlineExpired',
      note: 'silence after a provable send → Art. 77 complaint DRAFTED, never sent (ADR-008).',
    },
  });

/**
 * Handle one `deadline-expiry` job.
 *
 * STATE-GUARDED: the request is re-loaded and the event applied only if it still waits in the
 * matching state. A stale timer — the reply arrived meanwhile, the resend is already authorised, the
 * job was delivered twice — becomes a logged no-op rather than a wrong transition.
 */
export async function handleDeadlineExpiry(deps: DeadlineDeps, payload: DeadlinePayload): Promise<string> {
  const r = await deps.load(payload.requestId);
  if (!r) return `skip: request ${payload.requestId} not found`;

  const rule = EXPIRY[payload.kind];
  if (!rule) return `skip: unknown deadline kind "${payload.kind}" for ${payload.requestId}`;
  if (r.state !== rule.from) return `skip: ${r.id} is in ${r.state}, timer is stale`;

  // Do not fire early. pg-boss `startAfter` is a floor, not a guarantee, and a clock-critical
  // transition must never run against a deadline that has not actually passed.
  const due = payload.kind === 'provisional' ? r.provisionalDeadlineAt : r.deadlineAt;
  const now = deps.now();
  if (due && due.getTime() > now.getTime()) {
    return `skip: ${r.id} ${payload.kind} deadline is ${due.toISOString()}, not yet due`;
  }

  await deps.applyTransition(r.id, apply(r, rule.event, { actor: 'SYSTEM', now }));
  return `${payload.kind} deadline expired → ${payload.kind === 'provisional' ? 'AWAITING_REGISTERED_RESEND' : 'ESCALATION_DRAFTED'} (${r.id}) — ${rule.note}`;
}

/**
 * Periodic backstop for a lost timer. Deliberately re-uses `handleDeadlineExpiry` per row rather
 * than issuing a bulk UPDATE: the per-request state guard and the not-yet-due check are the whole
 * safety story, and a set-based sweep would bypass both.
 */
export async function sweepExpiredDeadlines(
  deps: DeadlineDeps & { findDue: (now: Date) => Promise<readonly DeadlinePayload[]> },
): Promise<readonly string[]> {
  const due = await deps.findDue(deps.now());
  const notes: string[] = [];
  for (const payload of due) notes.push(await handleDeadlineExpiry(deps, payload));
  return notes;
}
