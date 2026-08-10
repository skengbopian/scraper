# Request state machine

The `RightsRequest.state` field and its transitions. This is the safety- and law-critical core:
implement it explicitly, unit-test every transition, and make illegal transitions unrepresentable.

> **Normative status.** This file, `CLAUDE.md` §6 and `docs/05` §6 must agree **verbatim** on when the
> statutory clock starts. They previously did not (audit C1). The resolution recorded in
> `ARCHITECTURE-DECISIONS.md` ADR-012 is implemented below; if you are about to change the clock rules
> here, change all three or change none.

## States

| State | Meaning |
|---|---|
| `DRAFT` | created, not yet validated/sent |
| `BLOCKED_IDENTITY` | cannot proceed — identity not `VERIFIED`. **Not terminal**: resolves via `identityVerified` |
| `READY` | passed all guards (identity verified, mandate ok, idempotency ok, playbook valid) |
| `SENT` | dispatched via channel; awaiting send acknowledgement |
| `AWAITING_RESPONSE_PROVISIONAL` | sent on a **non-provable** channel (email/web-form). `provisionalDeadlineAt` set. **The statutory clock has NOT started.** Not escalatable |
| `AWAITING_RESPONSE` | **provable** send confirmed; the Art. 12(3) clock is running (`deadlineAt` set) |
| `AWAITING_REGISTERED_RESEND` | provisional deadline passed with no reply; waiting on the **user's** decision to send a registered re-send |
| `RESPONSE_RECEIVED` | a controller reply arrived; parsed; awaiting validation/decision |
| `NEEDS_HUMAN` | low parse confidence, ambiguous outcome, or send failure → human ops review |
| `COMPLIED` | controller satisfied the request (validated) — terminal (success) |
| `INCOMPLETE` | controller answered, but the answer is **materially incomplete** (validated) — distinct from refusal; triggers escalation |
| `REFUSED` | controller refused (validated) — triggers escalation |
| `ESCALATION_DRAFTED` | Art. 77 complaint drafted (NOT sent) — awaiting human send |
| `ESCALATED` | complaint sent by a human to the DPA |
| `CLOSED_FAILED` | abandoned/failed after escalation or drift — terminal |
| `WITHDRAWN` | user withdrew / mandate revoked — terminal |

**Terminal states:** `COMPLIED`, `CLOSED_FAILED`, `WITHDRAWN`. Everything else must have an outbound edge.

## Transitions (allowed)

```
DRAFT ──guardFail(identity)──────────────────────────▶ BLOCKED_IDENTITY
DRAFT ──guardFail(idempotency|mandate)───────────────▶ CLOSED_FAILED
DRAFT ──guardsPass───────────────────────────────────▶ READY

BLOCKED_IDENTITY ──identityVerified:guardsPass───────▶ READY
BLOCKED_IDENTITY ──identityVerified:guardFail────────▶ CLOSED_FAILED

READY ──dispatch─────────────────────────────────────▶ SENT

SENT ──provableSendConfirmed─────────────────────────▶ AWAITING_RESPONSE
                                                        (set deadlineAt = provableSendTime + deadlineDays)
SENT ──sendAccepted:nonProvable──────────────────────▶ AWAITING_RESPONSE_PROVISIONAL
                                                        (set provisionalDeadlineAt = sendTime + deadlineDays;
                                                         deadlineAt stays NULL — no statutory clock)
SENT ──sendPermanentlyFailed─────────────────────────▶ NEEDS_HUMAN

AWAITING_RESPONSE_PROVISIONAL ──responseIngested─────▶ RESPONSE_RECEIVED
AWAITING_RESPONSE_PROVISIONAL ──provisionalDeadlineExpired▶ AWAITING_REGISTERED_RESEND

AWAITING_REGISTERED_RESEND ──userConfirmsResend:guardsPass▶ READY   (next dispatch forced registered)
AWAITING_REGISTERED_RESEND ──responseIngested────────▶ RESPONSE_RECEIVED
AWAITING_REGISTERED_RESEND ──userDeclinesResend──────▶ CLOSED_FAILED  (outcome = NO_PROVABLE_CLOCK)

AWAITING_RESPONSE ──responseIngested─────────────────▶ RESPONSE_RECEIVED
AWAITING_RESPONSE ──deadlineExpired──────────────────▶ ESCALATION_DRAFTED   (escalation.onDeadlineExpiry)

RESPONSE_RECEIVED ──validated:complied───────────────▶ COMPLIED
RESPONSE_RECEIVED ──validated:incomplete─────────────▶ INCOMPLETE
RESPONSE_RECEIVED ──validated:refused────────────────▶ REFUSED
RESPONSE_RECEIVED ──lowConfidence|ambiguous──────────▶ NEEDS_HUMAN

NEEDS_HUMAN ──humanResolve:complied──────────────────▶ COMPLIED
NEEDS_HUMAN ──humanResolve:incomplete────────────────▶ INCOMPLETE
NEEDS_HUMAN ──humanResolve:refused───────────────────▶ REFUSED
NEEDS_HUMAN ──humanResolve:escalate──────────────────▶ ESCALATION_DRAFTED   (see invariant 3b)
NEEDS_HUMAN ──humanResolve:resend────────────────────▶ READY

INCOMPLETE ──escalate────────────────────────────────▶ ESCALATION_DRAFTED   (escalation.onIncompleteSourceList)
INCOMPLETE ──responseIngested────────────────────────▶ RESPONSE_RECEIVED    (supplementary answer)
REFUSED ──escalate───────────────────────────────────▶ ESCALATION_DRAFTED   (escalation.onRefusal)
REFUSED ──responseIngested───────────────────────────▶ RESPONSE_RECEIVED    (controller reverses itself)

ESCALATION_DRAFTED ──humanSend───────────────────────▶ ESCALATED
ESCALATION_DRAFTED ──humanDiscard────────────────────▶ CLOSED_FAILED
ESCALATION_DRAFTED ──responseIngested────────────────▶ RESPONSE_RECEIVED    (late reply)

ESCALATED ──responseIngested─────────────────────────▶ RESPONSE_RECEIVED    (complaint prompted a reply)
ESCALATED ──resolved:complied────────────────────────▶ COMPLIED
ESCALATED ──resolved:failed──────────────────────────▶ CLOSED_FAILED

(any non-terminal) ──userWithdraw|mandateRevoked─────▶ WITHDRAWN
```

## The clock (C1 — resolved)

**Email is not proof of delivery.** A DKIM-aligned accept proves *we sent*, not that *they received*.
The Art. 12(3) clock is therefore only ever started by a **provable** send.

| Channel | Send event | Sets | Escalatable on silence? |
|---|---|---|---|
| postal + `registered` (Einwurf-Einschreiben) + QTSP anchor | `provableSendConfirmed` | `deadlineAt` | **yes** |
| email (accepted + DKIM-aligned) | `sendAccepted:nonProvable` | `provisionalDeadlineAt` | no |
| web-form (submission receipt) | `sendAccepted:nonProvable` | `provisionalDeadlineAt` | no |

`provisionalDeadlineAt` is an **operational scheduling hint** — when to ask the user to escalate the
channel. It is never asserted to a controller or a DPA as a statutory deadline, and never rendered in a
letter or complaint as one.

**The chase path.** Email out on day 0 → silence → on `provisionalDeadlineExpired` the user is asked
(one decision, clear default) whether to send a registered re-send. On confirmation the request re-enters
`READY` with the registered channel forced; the resulting `provableSendConfirmed` sets a **fresh**
`deadlineAt = registeredSendTime + deadlineDays`. Escalation on silence therefore lands at roughly day 60.
That is deliberate: it is the only version we can prove end-to-end at a DPA.

**Statistics.** A request that ends in `CLOSED_FAILED` with `outcome = NO_PROVABLE_CLOCK` (the user
declined the registered re-send) contributes **nothing** to that controller's compliance statistics. No
provable clock ever ran, so its silence is not evidence of non-compliance. Recording it as one would
corrupt the census — the asset `docs/02` calls the moat and `docs/05` §7 later publishes as fact.

## Idempotency (C3 — resolved)

Two different concerns were previously conflated into one rule, which is why three documents disagreed.

**5a · Request-level idempotency — checked on every entry to `READY`.**
`idempotencyKey = sha256(userId | controllerId | requestType | cycleOrdinal)`, with a **DB unique
constraint** on it (`docs/03`). `cycleOrdinal = 1 + count(terminal predecessors for that triple)`.

- Guard text: *no **other** non-terminal `RightsRequest` exists for `(userId, controllerId, requestType)`.*
  The **self-exclusion is load-bearing**: without it the `NEEDS_HUMAN → resend` and
  `AWAITING_REGISTERED_RESEND → userConfirmsResend` paths block on themselves.
- A re-send is the **same row** — same key, no new row, never blocked.
- A deliberate re-exercise after the previous cycle closed increments `cycleOrdinal` → new key → allowed.
  This is what makes lawful annual Art. 15 re-access and the provenance follow-up chain possible.
- An accidental duplicate while one is in flight collides on the key → refused.
- **Re-exercise cooling guard** (Art. 12(5) "excessive"): a new cycle for an access-type request within
  `minReExerciseDays` of the previous cycle closing requires an explicit user re-exercise or a distinct
  `cause` (e.g. `PROVENANCE_CHAIN`). `TODO(counsel):` set `minReExerciseDays` per request type.

**5b · Send-level idempotency — checked at `dispatch`.**
A per-attempt key in the Controller Gateway so a retried/duplicated dispatch cannot put two identical
letters in the post. This is **not** the request-level guard and must not be implemented as one.

`CLAUDE.md` §8 says a request may not be sent twice **by accident**. 5a/5b prevent exactly that, and
nothing more — "twice, ever" is not the rule and would break the flagship.

## Invariants (assert in code + tests)

1. **No send before verification:** a request may only enter `READY` if `Identity.status == VERIFIED`
   and its subject fields equal `deriveFromIdentity(user)`. Otherwise `BLOCKED_IDENTITY`. This applies to
   **every** inbound edge to `READY`, not just the one from `DRAFT` — re-entry re-runs the full guard set.
2. **The clock is provable:** `deadlineAt` is set **only** on `provableSendConfirmed` (postal proof /
   Einwurf-Einschreiben receipt, anchored with a qualified eIDAS timestamp). Never on enqueue, never on an
   email accept, never on a web-form receipt. `provisionalDeadlineAt` is a separate field and is never
   presented as a statutory deadline.
3. **Escalation never auto-sends:** the only transition into `ESCALATED` is `humanSend`.
4. **Escalation rests on proven receipt.** Every path into `ESCALATION_DRAFTED` must be backed by evidence
   the controller received the request:
   - **3a (structural):** the silence path `deadlineExpired` exists only on `AWAITING_RESPONSE`, which is
     only reachable via `provableSendConfirmed`. Silence can therefore never escalate on a provisional
     clock — no runtime check needed.
   - **3b (guarded):** `INCOMPLETE`/`REFUSED --escalate-->` and `NEEDS_HUMAN --humanResolve:escalate-->`
     need no registered send, because the controller's **own reply proves receipt**. But
     `humanResolve:escalate` is reachable from a `sendPermanentlyFailed` entry into `NEEDS_HUMAN`, where no
     reply exists — so it must assert `provableSendConfirmedAt != null || a ControllerResponse exists`.
     This one is a guard, not a graph property. Test it.
5. **Parser can't decide alone:** transitions `validated:complied|incomplete|refused` require either
   deterministic validation rules matching **or** `reviewedByHuman == true`. Below
   `humanReviewIfConfidenceBelow` the only allowed target is `NEEDS_HUMAN`. This is a guard, not a graph
   property (see `docs/06` C4).
6. **`INCOMPLETE` is not `REFUSED`.** A materially incomplete answer — for `ACCESS_ART15_SOURCE`, a source
   list that omits a category the controller admits holding — is its own outcome. Recording it as a
   refusal corrupts per-controller statistics. Both provenance playbooks rely on this
   (`escalation.onIncompleteSourceList`), and before this edge existed it was unreachable (audit C4).
7. **Every transition writes an append-only `RequestEvent`** and, where a document/letter is produced or
   received, an `EvidenceRecord` (hash-chained + QTSP timestamp for clock-critical ones).

## Outcome vocabulary (distinct from `state`)

`outcome` is set when a request reaches a terminal state, and is what per-controller statistics aggregate.

| `outcome` | Meaning | Counts toward controller compliance stats? |
|---|---|---|
| `COMPLIED` | request satisfied | yes |
| `INCOMPLETE` | answered, materially incomplete | yes |
| `REFUSED` | expressly refused | yes |
| `NO_RESPONSE` | provable clock ran out in silence | yes |
| `NO_PROVABLE_CLOCK` | user declined the registered re-send | **no** |
| `WITHDRAWN` | user withdrew / mandate revoked | no |
| `ABANDONED` | discarded at `ESCALATION_DRAFTED`, or failed after escalation | no |

## Test matrix (minimum)
- verified vs unverified identity at creation,
- **identity verified after being blocked → `READY`, with all guards re-run** (C5),
- duplicate request blocked **while one is open**,
- **re-send does not block on itself** (self-exclusion) — from `NEEDS_HUMAN` and from
  `AWAITING_REGISTERED_RESEND`,
- **a second lawful cycle after the first closed is allowed** (annual Art. 15 re-access),
- **provenance chain: `OBJECTION_ART21` at a broker already objected to in M1 is allowed** once the M1
  cycle is closed,
- **email send sets `provisionalDeadlineAt` and NOT `deadlineAt`** (C1),
- **`AWAITING_RESPONSE_PROVISIONAL` cannot reach `ESCALATION_DRAFTED`** — assert by graph reachability,
  not by mocking (C1),
- registered re-send sets a **fresh** `deadlineAt` from the registered send time,
- user declines re-send → `CLOSED_FAILED` with `outcome = NO_PROVABLE_CLOCK`, and the controller's
  compliance stats are **unchanged**,
- deadline expiry with no response → drafted (not sent) complaint,
- refusal → drafted complaint,
- **incomplete answer → `INCOMPLETE` → drafted complaint** (C4),
- **`humanResolve:escalate` from a `sendPermanentlyFailed` `NEEDS_HUMAN` with no response is rejected**
  (invariant 3b),
- low-confidence parse → `NEEDS_HUMAN` (never auto-complied),
- **late response after `ESCALATION_DRAFTED` and after `ESCALATED` is ingestable** (H1),
- mandate revocation mid-flight → `WITHDRAWN`,
- send failure → `NEEDS_HUMAN`,
- **an Art. 77 complaint cannot be sent by any actor other than a human** — assert `ESCALATED` has
  exactly one inbound edge by graph analysis, so a future edge addition fails the test.
