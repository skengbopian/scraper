# 05 — Legal guardrails

**Not legal advice.** This encodes the constraints engineering must respect; a qualified German
data-protection + RDG lawyer signs off before anything ships. Where the product's behaviour depends on a
legal question, the code carries a `TODO(counsel):`.

## 1. Framing: rights agent, not request cannon

The **default action is the unconditional Art. 21(2) objection to direct marketing** and **Art. 15
access** — each user-initiated, individualised, one subject, with an explicit data-protection purpose.
Do **not** architect a bulk/undifferentiated Art. 15 "sweep" as the core funnel: the **Digital Omnibus**
(proposed Nov 2025) may let controllers refuse access requests made for non-data-protection purposes or
deemed excessive. Individualised, user-driven requests are the design defence; keep them that way.

## 2. Mandate (Vollmacht) and RDG

- Every action is backed by the user's authorisation. For anything **adversarial** (Art. 77 complaints,
  Schufa disputes, damages claims), require a **QES-signed Mandate** (eIDAS qualified signature) bound to
  the verified identity. This also closes mandate forgery.
- Sending a plain Art. 21(2) objection or Art. 15 request can be framed as a **Botendienst** (messenger
  service) — the user is the sender; we transmit. Keep that separation clean in code and copy.
- Fee-based **adversarial** work (drafting/pursuing complaints and damages) is likely a
  **Rechtsdienstleistung** under the RDG. Two compliant structures — pick one with counsel:
  (a) register as an **Inkassodienstleister**, or (b) **white-label** adversarial/damages work to partner
  lawyers. Engineering: keep adversarial actions behind a boundary that can route to a partner-lawyer flow.
- **Japan (future):** the 非弁 rule can make even *sending* a request "on behalf of" a user unlawful for a
  non-lawyer. Japan is enterable only as **user-initiated software** + a law-firm partner. Do not port the
  German "agent" model there.

## 3. No promised outcomes (ever)

Never generate copy that promises a result — no "we will raise your Schufa score", no "guaranteed
deletion". Score Studio (later) is framed as **accuracy, timing, and informed choice**. In a future US
entry, the **CROA** bars advance fees and outcome promises for credit-repair; keep score features as
education/self-help. German equivalent risks: UWG (misleading claims).

## 4. Scraper is itself a controller of sensitive data

- **DPIA is mandatory** (systematic monitoring + special-category-adjacent data + vulnerable subjects).
  Complete and sign it before launch; appoint a **DPO**.
- Honour **our own** Art. 15/17 duties: users (and third parties whose data appears in responses) can
  request access/erasure from us. Build the endpoint.
- **Lawful basis** for holding any breach corpora / response data must be documented; minimise and purge.

## 5. Data-subject accuracy (Art. 5(1)(d))

Do not submit knowingly false identity data to controllers. (This is also why canary "watermarks", when
Module 2 is built, use unique-but-accurate signals like distinct alias emails — never misspelled legal
names, and never on legal/financial forms.)

## 6. Evidence and the statutory clock

The Art. 12(3) one-month clock starts at a **provable** send. **Email is not proof of delivery** — a
DKIM-aligned accept proves we sent, not that they received. For clock-critical steps use
**Einwurf-Einschreiben** and anchor evidence with a **qualified eIDAS timestamp**. A self-generated hash
chain shows integrity but not trusted time; the QTSP provides the time.

This is one normative rule stated in three places — here, `CLAUDE.md` §6, and
`schema/request-state-machine.md`. They previously contradicted each other (audit C1); they now agree.
Change all three or change none. The operative consequences:

- An email or web-form send sets **`provisionalDeadlineAt`** only — an internal scheduling hint. It is
  never `deadlineAt`, and **never appears in a letter, a complaint, or any statement to a controller or a
  supervisory authority as a statutory deadline.** Asserting a deadline we cannot prove started is the
  legal exposure this rule exists to prevent.
- **`deadlineAt` is set only on a provable send.** On silence after a provisional send, the user is asked
  to authorise a registered re-send, which starts a **fresh** one-month period from the registered send.
- **Escalating on silence requires a provable send. Escalating on a refusal or a materially incomplete
  answer does not** — the controller's own reply is itself proof of receipt, so no registered re-send is
  needed to complain about the content of an answer we actually hold.
- A request the user chooses not to escalate to registered post closes as `NO_PROVABLE_CLOCK` and is
  **excluded from that controller's compliance statistics**. It is not evidence of non-compliance, and
  §7 below publishes those statistics as fact — so this exclusion is load-bearing, not bookkeeping.

`TODO(counsel):` confirm that a registered re-send restarting a full month (rather than setting a
shortened Nachfrist citing the original email) is the posture we want on first contact with a DPA. The
conservative reading is implemented; the practitioner alternative is recorded in
`ARCHITECTURE-DECISIONS.md` ADR-012.

## 7. The public scoreboard (Module 2, deferred) — defamation/UWG

When built, publish only **verifiable, self-evidenced facts** from the timestamped ledger
("responded in 34 days against a 30-day statutory clock"), never letter grades or editorialised
"worst offender" labels. Documented methodology + right of reply + legal sign-off.

## Counsel checklist (surface to the human operator)
- [ ] Templates in `templates/` reviewed and approved.
- [ ] RDG structure chosen (Inkasso vs lawyer-partner) and implemented as a routing boundary.
- [ ] Mandate/QES flow reviewed; messenger-service vs legal-service line documented.
- [ ] DPIA complete, DPO appointed, EU hosting + EU inference confirmed.
- [ ] Marketing copy reviewed for outcome-promise / UWG risk.
