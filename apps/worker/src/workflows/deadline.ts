import { apply, type RequestSnapshot, type TransitionResult } from '@scraper/core';

/**
 * Deadline expiry — THREE paths, not one (port wave 5, ADR-037; third added by audit F3a).
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
 *   proof expiry       → NEEDS_HUMAN
 *       A registered letter was lodged and the Auslieferungsbeleg never came back. We do not know
 *       whether it was delivered, which is precisely why this cannot escalate: a complaint founded
 *       on our own ignorance is worse than no complaint. A person chases the carrier, or records the
 *       paper receipt through the ops delivery-proof route, which applies the same
 *       `provableSendConfirmed` the retrieval job would have.
 *
 * Invariant 3a makes the separation structural rather than a runtime check: `deadlineExpired` exists
 * ONLY on AWAITING_RESPONSE, which is reachable ONLY via `provableSendConfirmed`. The state guard
 * below is therefore a staleness filter, not the safety mechanism — if it were deleted, `apply()`
 * would still refuse, and `tools/spec-audit/statemachine.mjs` asserts the forbidden path is absent.
 */

export interface DeadlinePayload {
  readonly requestId: string;
  /**
   * Three timers, and only ONE of them is a deadline in any legal sense.
   *   `statutory`   — the Art. 12(3) month. Expiry drafts an Art. 77 complaint.
   *   `provisional` — when to ask the USER to escalate the channel. Expiry starts the chase.
   *   `proof`       — when to stop waiting for a carrier's Auslieferungsbeleg. Expiry asks a HUMAN.
   */
  readonly kind: 'provisional' | 'statutory' | 'proof';
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
const EXPIRY: Readonly<
  Record<
    DeadlinePayload['kind'],
    { readonly from: RequestSnapshot['state']; readonly to: RequestSnapshot['state']; readonly event: string; readonly note: string }
  >
> = Object.freeze({
    provisional: {
      from: 'AWAITING_RESPONSE_PROVISIONAL',
      to: 'AWAITING_REGISTERED_RESEND',
      event: 'provisionalDeadlineExpired',
      note: 'the chase step — the USER decides about the registered re-send (ADR-012). No complaint is drafted.',
    },
    statutory: {
      from: 'AWAITING_RESPONSE',
      to: 'ESCALATION_DRAFTED',
      event: 'deadlineExpired',
      note: 'silence after a provable send → Art. 77 complaint DRAFTED, never sent (ADR-008).',
    },
    proof: {
      from: 'AWAITING_DELIVERY_PROOF',
      to: 'NEEDS_HUMAN',
      event: 'proofRetrievalFailed',
      // The asymmetry with `statutory` is the entire point. A statutory month running out in
      // silence is EVIDENCE about the controller. A delivery receipt failing to come back is
      // evidence about our postal vendor and about nothing else — we do not know whether the letter
      // arrived. Escalating on it would found an Art. 77 complaint on our own ignorance, so this
      // one goes to a person, who can chase the carrier or record the paper receipt by hand.
      note: 'the carrier receipt never came back → NEEDS_HUMAN. A MISSING proof never escalates (F3a).',
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
  const due = DUE_FIELD[payload.kind](r);
  const now = deps.now();
  if (due && due.getTime() > now.getTime()) {
    return `skip: ${r.id} ${payload.kind} deadline is ${due.toISOString()}, not yet due`;
  }

  await deps.applyTransition(r.id, apply(r, rule.event, { actor: 'SYSTEM', now }));
  return `${payload.kind} deadline expired → ${rule.to} (${r.id}) — ${rule.note}`;
}

/**
 * Which column each timer reads. A table for the same reason `EXPIRY` is one: a fourth timer that
 * forgets to say which field it measures should not compile, and the previous ternary
 * (`provisional ? provisionalDeadlineAt : deadlineAt`) silently answered "deadlineAt" for every kind
 * that was not `provisional` — which would have made a `proof` timer check the STATUTORY clock and,
 * finding it null, fire unconditionally.
 */
const DUE_FIELD: Readonly<Record<DeadlinePayload['kind'], (r: RequestSnapshot) => Date | null>> = Object.freeze({
  provisional: (r) => r.provisionalDeadlineAt,
  statutory: (r) => r.deadlineAt,
  proof: (r) => r.proofDueAt,
});

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
