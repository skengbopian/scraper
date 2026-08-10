# 04 — Playbook specification

A **playbook** is versioned, machine-readable instructions for exercising one right against one
controller. It is the amortised asset: written once, reviewed by counsel once, then run for every user at
near-zero marginal cost. The engine never improvises legal content — it selects a counsel-approved
template and fills verified-identity fields.

## File format

YAML, one file per `(controller, requestType)`, validated against `schema/playbook.schema.json`.

```yaml
slug: werbewiderspruch.az-direct
kind: RIGHTS_REQUEST                  # RIGHTS_REQUEST | ENROLMENT — see "Two kinds of playbook" below
controller: az-direct                 # Controller.slug
requestType: OBJECTION_ART21          # OBJECTION_ART21 | ACCESS_ART15 | ACCESS_ART15_SOURCE | ERASURE_ART17
version: 3                            # bump on any change; old versions retained for audit
active: false                         # REQUIRED. absent must be read as false — see note below
legalBasis: "DSGVO Art. 21 Abs. 2"    # human-readable; counsel-owned
channel:
  primary: email                      # email | web_form | postal
  fallback: postal                    # what to do if primary fails/bounces
  registered:                         # PER-CHANNEL. Einwurf-Einschreiben is postal-only.
    primary: false                    # invalid (schema-rejected) unless that channel is postal
    fallback: true                    # the registered re-send goes out on the postal fallback
recipient:
  email: datenschutz@az-direct.de
  postal: "AZ Direct GmbH, Datenschutz, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh"
template: art21-werbewiderspruch.de   # file in templates/, Handlebars-style variables
identityProof:
  required: false                     # some controllers demand ID to process; see identityProof note
  accepts: [none]                     # must be consistent with `required` — see below
subjectFields:                        # which verified-identity fields the template needs
  - legalName
  - addresses
deadlineDays: 30                      # Art. 12(3) — clock starts at a PROVABLE send only
validation:                          # deterministic checks on the controller's RESPONSE
  compliedIf:
    anyOf:
      - responseContains: ["Widerspruch", "gelöscht", "keine Werbung"]
      - structured.marketingStopped: true
  refusedIf:
    anyOf:
      - responseContains: ["berechtigtes Interesse", "lehnen wir ab"]
  humanReviewIfConfidenceBelow: 0.75  # REQUIRED, and must be meaningfully above 0 (docs/06 C4)
escalation:
  onDeadlineExpiry: DRAFT_ART77       # draft only — never auto-send
  onRefusal: DRAFT_ART77
notes: >
  Art. 21(2) objection to direct marketing is unconditional (no balancing). If the controller demands
  ID to process a pure marketing objection, that is itself over-collection — see templates note.
```

Two corrections to what this example used to show, both from the audit:

- **`identityProof`**: it previously paired `required: false` with `accepts: [redacted_id]`, which reads as
  "we don't need to prove identity, but here is an ID anyway" — the over-collection `docs/07` warns
  against. `accepts` is the *ceiling* of what we will hand over, so `required: false` pairs with
  `[none]`. The inverse — `required: true` with `accepts: [none]` — is self-contradictory and is rejected
  at schema level.
- **`active`**: JSON Schema's `default: false` is annotation-only; validators never apply it, so an
  omitted `active` was silently valid. It is now required, and the loader must additionally treat absent
  as false rather than trusting the schema.

## Two kinds of playbook (audit H3)

`ROBINSON` and `EINMELDUNG_FRAUD` are **not rights requests**. A DDV Robinsonliste enrolment and a Schufa
fraud victim marker have no Art. 12(3) clock and no Art. 77 remedy — you cannot complain to a DPA that an
industry opt-out list was slow. The schema nonetheless *required* `deadlineDays` and `escalation` on every
playbook, forcing both to declare a statutory deadline and an escalation route they have no legal basis
for, while `docs/08` already modelled suppression correctly. Reconciled with a discriminator:

| `kind` | `requestType` values | `deadlineDays` / `escalation` | Materialises as |
|---|---|---|---|
| `RIGHTS_REQUEST` (default) | the four statutory types | **required** | `RightsRequest` + state machine |
| `ENROLMENT` | `ROBINSON`, `EINMELDUNG_FRAUD` | **forbidden** | `SuppressionEnrolment` / `FraudMarkerFiling` |

An `ENROLMENT` playbook instead carries `enrolment: { programSlug, renewalMonths?, producesEntity }`.
See the `ActionType` table in `docs/03`.

## The channel/clock contract (audit C1 + H2)

`registered` was a single boolean for a two-channel config, which let
`loeschung.generic-adresshaendler` declare `primary: email` + `registered: true` — Einwurf-Einschreiben by
email is not a thing. It is now per-channel and **schema-rejected on `email` and `web_form`**.

The rule that ties this to the clock: **a playbook that escalates on deadline expiry must be able to reach
a provable send.** Concretely — if `escalation.onDeadlineExpiry: DRAFT_ART77` and the primary channel is
not postal-registered, the playbook must declare a `postal` fallback with `registered.fallback: true`.
That fallback is the registered re-send the user authorises when the provisional deadline passes. Without
it the request can never escalate on silence and would dead-end. Linted by `tools/spec-audit/audit.mjs`.

## How the engine runs a playbook

1. **Guard:** confirm `Identity.status == VERIFIED` and a valid `Mandate` covers `requestType`
   (objections may be messenger-service only; escalation requires mandate — see `docs/05`). Guards run on
   **every** entry to `READY`, including re-entry from a resend or from `BLOCKED_IDENTITY`.
2. **Idempotency:** refuse if any **other** non-terminal `RightsRequest` exists for
   `(user, controller, requestType)`. The self-exclusion is required, or the resend paths block on their
   own row. A deliberate new cycle after the previous one closed is allowed and increments `cycleOrdinal`.
   One spec, three files: `docs/03` §Idempotency and `schema/request-state-machine.md` §Idempotency say
   the same thing — audit C3.
3. **Render:** load `template`, inject `subjectFields` from the verified Identity snapshot. No free text.
   If `identityProof.required: true`, attach the `IdentityPacket` and set the `identityProofEnclosed`
   flag so the template's enclosure sentence renders. If it is false, the flag is false and the sentence
   is omitted — a letter must never assert an enclosure it does not carry (audit C6).
4. **Send:** via the channel (email/web-form/postal). For Phase 0, `web_form` is **not** automated —
   it drops to the human queue. Capture an outbound `EvidenceRecord` (rendered copy + hash + timestamp).
   Where `registered.<channel>: true`, use Einwurf-Einschreiben and store the postal proof.
5. **Clock:** a **provable** send (registered post + QTSP anchor) sets
   `deadlineAt = provableSendTime + deadlineDays` and moves to `AWAITING_RESPONSE`. An email or web-form
   send sets `provisionalDeadlineAt` only and moves to `AWAITING_RESPONSE_PROVISIONAL` — the statutory
   clock has **not** started. See `CLAUDE.md` §6 and `docs/05` §6.
6. **Chase (provisional path only):** when `provisionalDeadlineAt` passes with no reply, ask the **user**
   to authorise a registered re-send on the postal fallback. On confirmation the request re-enters `READY`
   with the registered channel forced and the resulting provable send starts a **fresh** month. If the
   user declines, close as `NO_PROVABLE_CLOCK` — and do **not** count it against the controller's stats.
7. **Ingest response:** email/webhook or scanned post → the **doc sandbox** returns `structured` +
   `confidence`. Apply `validation`. Below `humanReviewIfConfidenceBelow`, route to human — never
   auto-decide. A late reply is ingestable from `ESCALATION_DRAFTED` and `ESCALATED` too.
8. **Resolve or escalate:** `compliedIf` → `COMPLIED`; `refusedIf` → `REFUSED` → `escalation.onRefusal`;
   a materially incomplete answer → `INCOMPLETE` → `escalation.onIncompleteSourceList`; provable deadline
   passes with no response → `escalation.onDeadlineExpiry`. Escalation **drafts** an Art. 77 complaint
   (with evidence pack) for human review; it does not send it.

## Playbook health (Phase 1)

Each playbook has a monitor (synthetic submission / DOM- or letter-diff) that detects when a controller
changes its form or response wording. On drift: mark playbook `active=false`, alert, and fail matching
requests **closed to the human queue** rather than sending malformed requests at scale.

## Authoring rules

- Legal wording lives only in `templates/`, counsel-reviewed. Playbooks reference templates; they don't
  contain prose.
- Any change bumps `version`; never mutate a shipped version (audit trail).
- Prefer the least-collecting instrument: Art. 21(2) objection before Art. 17 erasure for marketing data;
  correction (not deletion) for credit bureaus.
