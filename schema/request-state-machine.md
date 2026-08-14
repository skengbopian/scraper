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
| `AWAITING_DELIVERY_PROOF` | a **registered** letter was lodged with the carrier (Einlieferung) and the delivery receipt (Auslieferungsbeleg) has not come back yet. **No clock runs at all** — neither statutory nor provisional. `proofDueAt` is an operational hint for the retrieval job. Not escalatable |
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
                                                        (set deadlineAt = end of the Art. 12(3) CALENDAR
                                                         month from the EVIDENCED DELIVERY time —
                                                         Reg. 1182/71 / EDPB Guidelines 01/2022 §54:
                                                         same-numbered day next month, clamped to month
                                                         end, extended over Sat/Sun/bundesweite Feiertage,
                                                         Europe/Berlin end of day. NOT deadlineDays × 24h,
                                                         which fires up to a day early on 31-day months)
SENT ──registeredSendLodged──────────────────────────▶ AWAITING_DELIVERY_PROOF
                                                        (Einlieferung ≠ Zustellung. Sets NO clock —
                                                         deadlineAt AND provisionalDeadlineAt both stay
                                                         NULL. Sets proofDueAt = lodgement + 14 days,
                                                         an OPERATIONAL retrieval hint that is never a
                                                         deadline of any kind. TODO(counsel): 14 days)
SENT ──sendAccepted:nonProvable──────────────────────▶ AWAITING_RESPONSE_PROVISIONAL
                                                        (set provisionalDeadlineAt = sendTime + deadlineDays;
                                                         deadlineAt stays NULL — no statutory clock)
SENT ──sendPermanentlyFailed─────────────────────────▶ NEEDS_HUMAN

AWAITING_DELIVERY_PROOF ──provableSendConfirmed──────▶ AWAITING_RESPONSE
                                                        (the receipt arrived. deadlineAt is computed from
                                                         the EVIDENCED delivery time, never from when we
                                                         fetched the receipt — see §The clock)
AWAITING_DELIVERY_PROOF ──responseIngested───────────▶ RESPONSE_RECEIVED
                                                        (a controller who replies has proven receipt
                                                         themselves; no carrier receipt is needed)
AWAITING_DELIVERY_PROOF ──proofRetrievalFailed───────▶ NEEDS_HUMAN
                                                        (proofDueAt passed with no receipt. A MISSING
                                                         receipt never escalates — it asks a human)

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
NEEDS_HUMAN ──humanResolve:escalate──────────────────▶ ESCALATION_DRAFTED   (see invariant 4b)
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
| postal + `registered` + carrier receipt in hand + QTSP anchor | `provableSendConfirmed` | `deadlineAt` | **yes** |
| postal + `registered`, receipt not back yet (Einlieferung) | `registeredSendLodged` | `proofDueAt` only | no |
| email (accepted + DKIM-aligned) | `sendAccepted:nonProvable` | `provisionalDeadlineAt` | no |
| web-form (submission receipt) | `sendAccepted:nonProvable` | `provisionalDeadlineAt` | no |

`provisionalDeadlineAt` is an **operational scheduling hint** — when to ask the user to escalate the
channel. It is never asserted to a controller or a DPA as a statutory deadline, and never rendered in a
letter or complaint as one. `proofDueAt` is weaker still: it is when to give up waiting for a carrier
receipt and ask a human. Neither is a deadline in any legal sense.

**The provable send may be confirmed ASYNCHRONOUSLY.** The clock rule does not change — only a provable
send starts it — but a real carrier does not hand over the Auslieferungsbeleg at the counter. So the
registered path is two steps: lodgement puts the request in `AWAITING_DELIVERY_PROOF` with no clock, and
the receipt, whenever it arrives, applies `provableSendConfirmed` from there. Without this state the
statutory clock was unreachable in production: with an honest postal adapter (`proof: null` at
lodgement — audit F3b) every registered send degraded to the provisional clock and had nowhere to be
upgraded to (audit F3a).

**The month runs from DELIVERY, not from retrieval.** Art. 12(3) is "one month of receipt of the
request", so `deadlineAt` is computed from `ctx.deliveredAt` — the time the carrier's receipt evidences —
and NOT from the moment our retrieval job happened to fetch that receipt. Fetching is our scheduling; a
day of queue latency that quietly extended the controller's month would be us giving away the user's
statutory time. `ctx.deliveredAt` is therefore **required** on the asynchronous edge
(`AWAITING_DELIVERY_PROOF --provableSendConfirmed-->`) and may never be in the future.

**A missing receipt is a human question, never an escalation.** `proofRetrievalFailed` goes to
`NEEDS_HUMAN`. There is deliberately no edge from `AWAITING_DELIVERY_PROOF` to anything that drafts a
complaint: not knowing whether a letter was delivered is the opposite of evidence that it was.

**The manual path is the primary one today.** Automated Auslieferungsbeleg retrieval is blocked on the
postal vendor (OQ-11). An ops human who holds the paper receipt records it — the API mints the
POSTAL_PROOF evidence record, anchors it, and applies exactly the same `provableSendConfirmed`
transition the retrieval job will later apply. Automation replaces the actor, not the rule.

**The chase path.** Email out on day 0 → silence → on `provisionalDeadlineExpired` the user is asked
(one decision, clear default) whether to send a registered re-send. On confirmation the request re-enters
`READY` with the registered channel forced; the resulting `provableSendConfirmed` sets a **fresh**
Art. 12(3) calendar month from the registered send time (same rules as above). Escalation on silence
therefore lands at roughly day 60.
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
   email accept, never on a web-form receipt, and never on a registered **lodgement**.
   `provisionalDeadlineAt` and `proofDueAt` are separate fields and neither is ever presented as a
   statutory deadline. The confirming event may arrive later than the send (from
   `AWAITING_DELIVERY_PROOF`); when it does, the month is measured from the evidenced delivery time, so
   the clock's LENGTH does not depend on when we got around to fetching the receipt.
3. **Escalation never auto-sends:** the only transition into `ESCALATED` is `humanSend`.
4. **Escalation rests on proven receipt.** Every path into `ESCALATION_DRAFTED` must be backed by evidence
   the controller received the request:
   - **4a (structural):** the silence path `deadlineExpired` exists only on `AWAITING_RESPONSE`, which is
     only reachable via `provableSendConfirmed` — from `SENT` or from `AWAITING_DELIVERY_PROOF`, both of
     which demand the branded evidence id. Silence can therefore never escalate on a provisional clock,
     nor on a lodgement whose receipt never came back — no runtime check needed. This is why the async
     upgrade is a dedicated STATE rather than a second edge out of `AWAITING_RESPONSE_PROVISIONAL`: email
     sends live in that state too, so an upgrade edge there would have to be gated by a runtime `if`,
     converting a graph guarantee into a check someone can later relax.
   - **4b (guarded):** `INCOMPLETE`/`REFUSED --escalate-->` and `NEEDS_HUMAN --humanResolve:escalate-->`
     need no registered send, because the controller's **own reply proves receipt**. But
     `humanResolve:escalate` is reachable from a `sendPermanentlyFailed` entry into `NEEDS_HUMAN`, where no
     reply exists — so it must assert `provableSendConfirmedAt != null || a ControllerResponse exists`.
     This one is a guard, not a graph property. Test it.
     (Historical labels “3a/3b” — from before "escalation never auto-sends" became its own invariant 3 —
     appear in older code comments; they mean 4a/4b.)
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
| `ABANDONED` | discarded at `ESCALATION_DRAFTED`, or failed after escalation — **unless** the case is provable silence (below) | no |

**Silence provenance wins over discard mechanics.** A request whose statutory clock expired with no
`ControllerResponse` ever ingested closes as `NO_RESPONSE` even when the closing event is
`humanDiscard` or `resolved:failed` — what the census records is what the *controller* did (silence on
a provable month), not what we then chose to do about the drafted complaint. Discards of drafts born of
a refusal/incomplete answer (a reply exists) and pre-expiry discards remain `ABANDONED`. Without this
rule `NO_RESPONSE` was unreachable: every terminal path out of a silence case produced `ABANDONED`,
which is excluded from the stats — total silence was structurally unrecordable (audit F2).

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
- **a registered lodgement sets NEITHER clock** — `registeredSendLodged` leaves `deadlineAt` and
  `provisionalDeadlineAt` null and sets only `proofDueAt` (F3a),
- **`AWAITING_DELIVERY_PROOF` cannot reach `ESCALATION_DRAFTED` except through `provableSendConfirmed`**
  — assert by graph reachability with that event banned (F3a),
- **the async confirmation dates the month from the receipt, not from the fetch** — a
  `provableSendConfirmed` applied from `AWAITING_DELIVERY_PROOF` with `deliveredAt` days before `now`
  produces the same `deadlineAt` as a synchronous confirmation at `deliveredAt` would have,
- **`provableSendConfirmed` from `AWAITING_DELIVERY_PROOF` without `deliveredAt` is refused**, and a
  `deliveredAt` in the future is refused,
- **a proof that never arrives goes to `NEEDS_HUMAN`, never to a complaint** (`proofRetrievalFailed`),
- registered re-send sets a **fresh** `deadlineAt` from the registered send time,
- user declines re-send → `CLOSED_FAILED` with `outcome = NO_PROVABLE_CLOCK`, and the controller's
  compliance stats are **unchanged**,
- deadline expiry with no response → drafted (not sent) complaint,
- refusal → drafted complaint,
- **incomplete answer → `INCOMPLETE` → drafted complaint** (C4),
- **`humanResolve:escalate` from a `sendPermanentlyFailed` `NEEDS_HUMAN` with no response is rejected**
  (invariant 4b),
- low-confidence parse → `NEEDS_HUMAN` (never auto-complied),
- **late response after `ESCALATION_DRAFTED` and after `ESCALATED` is ingestable** (H1),
- mandate revocation mid-flight → `WITHDRAWN`,
- send failure → `NEEDS_HUMAN`,
- **an Art. 77 complaint cannot be sent by any actor other than a human** — assert `ESCALATED` has
  exactly one inbound edge by graph analysis, so a future edge addition fails the test.
