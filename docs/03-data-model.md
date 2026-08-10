# 03 — Data model

Target: Prisma schema over PostgreSQL. Entities and the invariants that matter for safety/law are below.
Field lists are indicative, not exhaustive — get the relations and the invariants right.

## Entities

### User
Account holder. `id`, `email`, `authCredentials`, `createdAt`, `subscriptionStatus`.
- A User with no `VERIFIED` Identity can browse but **cannot** create a `RightsRequest`.

### Identity  (the safety keystone)
The verified real-world identity, from the ident provider. One current record per User.
- `id`, `userId`, `status` (`UNVERIFIED | PENDING | VERIFIED | EXPIRED`), `method` (`BANK_IDENT | EID`),
  `legalName`, `dateOfBirth`, `addresses[]` (current + historical, each verified), `verifiedAt`, `providerRef`.
- **Invariant:** the subject identifiers of every `RightsRequest` are *derived from this record*, never
  free-typed. There is no code path to send a request about a name/DOB/address not present here.

### IdentityPacket  (the `docs/08` Tier-2 "pre-verified identity packet")
**Added to close audit C6.** Three templates state that the sender encloses a redacted ID copy
(*"füge ich … eine geschwärzte Ausweiskopie bei"*), and `identityProof.required: true` on 3 of 5 playbooks
demands one — but no entity could produce it. A letter asserting an enclosure it does not contain gets
rejected for failure to identify, which burns the one-month clock **and** records a false "non-compliant
controller" statistic against the census. Either the packet exists or the claim comes out of the letters;
this is the former.

One current packet per Identity. It is **not** the raw identity document.
- `id`, `identityId`, `kind` (`REDACTED_ID_COPY | NONE`), `redactionProfile`, `storageRef` (encrypted,
  EU object store), `sha256`, `generatedAt`, `expiresAt`, `sourceProviderRef`, `lastAttachedAt`.
- **Invariant (derivation):** generated only from the `VERIFIED` Identity — from the ident provider's
  document image where the provider returns one, or from a user upload whose OCR'd name and date of birth
  are asserted to match the verified `Identity` before the packet is created. A packet that does not match
  the verified Identity is never created. There is no path to attach a packet belonging to anyone else.
- **Invariant (minimisation):** attached to an outbound request **only** when that playbook sets
  `identityProof.required: true`, and only in the least-revealing form the playbook's
  `identityProof.accepts` permits. `required: true` with `accepts: [none]` is a contradiction and must be
  rejected at schema level. `full_id` on a bare Art. 21(2) marketing objection is over-collection — the
  templates push back on the demand rather than satisfying it (`docs/07`).
- **Invariant (rendering):** the enclosure sentence in a template is emitted only when a packet is
  actually attached. The templates gate it on the `identityProofEnclosed` flag for exactly this reason.
- **Retention:** purge the stored artefact once every request that referenced it is terminal and the
  dispute window has passed; retain the `sha256` and the `EvidenceRecord` link, not the image.
- **Storage:** segregated store, envelope-encrypted, key gated on step-up auth — this is the highest-value
  single object in the account and `docs/06` C2 treats the account as a takeover jackpot.

`TODO(safety):` decide the acquisition route (ident-provider document vs user upload). A user upload is a
new ingestion path for an image we then store — it needs its own threat model, and it must not become a
general "upload an ID" endpoint that could accept a third party's document.
`TODO(safety):` fix the `redactionProfile` and prove the redaction is destructive (flattened raster, no
recoverable layer), not an overlay.
`TODO(counsel):` §20 PAuswG constrains copying a German Personalausweis — which fields may be blacked out,
that the copy be identifiable as a copy, and that the serial number not be used as a retrieval key.
Confirm the default profile against it, and confirm which controllers may lawfully demand a copy at all.

### Mandate
The user's authorisation (Vollmacht) to act on their behalf, QES-signed.
- `id`, `userId`, `scope` (which request types), `qesSignatureRef`, `documentHash`, `signedAt`, `revokedAt?`.
- **Invariant:** an adversarial/escalation action (Art. 77 complaint, dispute) requires a valid Mandate.

### Controller  (the census — the moat)
A data controller we can send requests to.
- `id`, `slug`, `legalName`, `type` (`CREDIT_BUREAU | ADDRESS_TRADER | DIRECTORY | ECOMMERCE | OTHER`),
  `country`, `channels` (which of email/web-form/postal it honours + the address/endpoint for each),
  `legalBasisNotes`, `identityProofRequired` (what it demands to process a request),
  `responseNormDays`, `playbookSlug`, `stats` (rolling response rate, avg days) — see playbook spec.
- From `docs/09` (pivot): `role` (`BUREAU | BROKER | DIRECTORY`), `seatDpa` (the competent supervisory
  authority for an Art. 77 complaint — mirrors the playbook `seatDpa` enum and the `seat / DPA` column in
  `docs/07`), `namesSourcesInArt14` (bool), `art15SourceRouteVerified` (bool).
- **Invariant (stats integrity):** `stats` aggregates only requests whose `outcome` is marked as counting
  toward compliance — see the outcome table in `schema/request-state-machine.md`. A request that never had
  a provable clock, or that the user withdrew, is excluded. `docs/05` §7 publishes these numbers as
  self-evidenced fact, so an over-counted denominator is a defamation exposure, not a reporting bug.

### Playbook
Versioned instructions for acting against one Controller for one purpose. Stored as a row referencing a
YAML file (or the YAML parsed into JSONB). See `docs/04-playbook-spec.md`.
- `id`, `controllerId`, `requestType`, `version`, `channel`, `templateId`, `validationRules`, `active`.

### ActionType  (one shared vocabulary — audit H6)
`docs/03` previously listed 4 types while the schema and `docs/09` defined 6. One enum, six values — but
they are **not all rights requests**, and that is the substance of the fix, not the count:

| Value | Statutory? | Materialises as |
|---|---|---|
| `OBJECTION_ART21` | yes — Art. 21(2) | `RightsRequest` |
| `ACCESS_ART15` | yes — Art. 15 | `RightsRequest` |
| `ACCESS_ART15_SOURCE` | yes — Art. 15(1)(g) | `RightsRequest` |
| `ERASURE_ART17` | yes — Art. 17(1) | `RightsRequest` |
| `ROBINSON` | **no** — industry self-regulation | `SuppressionEnrolment` |
| `EINMELDUNG_FRAUD` | **no** — voluntary victim marker | `FraudMarkerFiling` |

**`RightsRequest.requestType` is constrained to the four statutory values.** A DDV Robinsonliste enrolment
and a Schufa fraud marker have no Art. 12(3) clock and no Art. 77 remedy — you cannot complain to a DPA
that an industry opt-out list was slow. Forcing them through the rights-request machinery made the schema
require a fictional statutory deadline and escalation route on both (audit H3), while `docs/08` already
modelled suppression correctly. They are reconciled here rather than left as two competing models.

### RightsRequest  (the ticket — the orchestrator's unit of work)
One exercise of one **statutory** right, by one user, against one controller.
- `id`, `userId`, `controllerId`, `playbookId`,
  `requestType` (`OBJECTION_ART21 | ACCESS_ART15 | ACCESS_ART15_SOURCE | ERASURE_ART17`),
  `state` (see state machine), `channel`, `registered` (bool — was this dispatch a registered send),
  `sentAt?`, `provisionalDeadlineAt?`, `deadlineAt?`, `provableSendConfirmedAt?`, `closedAt?`, `outcome?`,
  `cause?` (`USER_INITIATED | PROVENANCE_CHAIN | FRAUD_REPAIR`), `supersedesRequestId?`,
  `cycleOrdinal`, `idempotencyKey`.
- **Invariant:** creation is blocked unless `Identity.status == VERIFIED`; subject fields snapshot from Identity.
- **Invariant (the clock):** `deadlineAt` is non-null **only** if `provableSendConfirmedAt` is non-null.
  `provisionalDeadlineAt` is a separate column precisely so no query can mistake one for the other. Enforce
  as a DB `CHECK` constraint, not only in application code — see `CLAUDE.md` §6.

#### Idempotency (audit C3 — one spec, replacing three)
The previous `unique(userId, controllerId, requestType)` was a permanent constraint that would have
silently killed the flagship: it blocks the provenance follow-up to a broker already contacted in M1, it
blocks lawful annual Art. 15 re-access, and the resend path self-blocks against its own open row.

- `cycleOrdinal` = `1 + count(terminal predecessors for (userId, controllerId, requestType))`.
- `idempotencyKey = sha256(userId | controllerId | requestType | cycleOrdinal)`, **`UNIQUE`**.
- The guard, re-run on **every** entry to `READY`: *no **other** non-terminal `RightsRequest` exists for
  that triple.* The self-exclusion is what unblocks the resend paths.
- A re-send is the same row — same `cycleOrdinal`, same key, no new row.
- `supersedesRequestId` links a new cycle to the one it follows, so the ledger reads as a chain.
- Art. 12(5) "excessive" is handled by a **re-exercise cooling guard**, not by the unique constraint —
  see `schema/request-state-machine.md` §"Idempotency". `TODO(counsel):` set `minReExerciseDays` per type.
- A separate **send-level** idempotency key lives in the Controller Gateway and is checked at `dispatch`;
  it stops a retried dispatch putting two letters in the post. Do not implement it as the same thing.

### SuppressionProgram / SuppressionEnrolment  (non-statutory — from `docs/08`)
Industry self-regulation the brokers voluntarily ingest. **No statutory clock, no Art. 77 escalation.**
- `SuppressionProgram`: `slug`, `name`, `jurisdiction`, `channel`, `renewalMonths`.
- `SuppressionEnrolment`: `userId`, `programId`, `state`, `enrolledAt`, `expiresAt`.
- `ROBINSON` actions materialise here. A renewal job matters — a silent lapse is a silent welfare loss.

### FraudMarkerFiling  (non-statutory — `docs/09` Fraud Shield)
The Schufa Identitätsbetrug-Einmeldung victim marker and equivalents. A guided filing, not a demand.
- `userId`, `controllerId`, `state`, `filedAt`, `identityPacketId?`, `evidenceRecordId?`, `confirmedAt?`.
- **No `deadlineAt`, no escalation route.** It does not affect the score; do not present it as if it does.
- `TODO(counsel):` confirm the current Schufa Einmeldung route and what proof it requires.

### ProvenanceLedger / ProvenanceEntry  (the flagship's output — from `docs/09`)
Per user, per bureau: what the controller said about where each data category came from.
- `ProvenanceLedger`: `userId`, `controllerId`, `rightsRequestId`, `createdAt`.
- `ProvenanceEntry`: `ledgerId`, `dataCategory`, `statedSource`, `statedLegalBasis`, `isBroker` (bool),
  `confidence`, `evidenceRecordId`.
- **Invariant:** entries are parser output and are therefore **advisory** (`docs/06` C4). A broker named
  here may not auto-spawn a downstream `ERASURE_ART17`/`OBJECTION_ART21` below the confidence threshold or
  without a human step — the chained follow-up is a new outbound legal action, which is exactly the class
  of irreversible act `CLAUDE.md` §2 forbids parser output from triggering.
- **Invariant:** a missing source for a category the controller admits holding is what
  `validated:incomplete` keys on. It is `INCOMPLETE`, never `REFUSED` — see the state machine, invariant 6.

### RequestEvent  (append-only audit)
Every state transition / action.
- `id`, `requestId`, `type`, `fromState`, `toState`, `actor` (`SYSTEM | USER | HUMAN_OPS`), `payload`, `createdAt`.

### ControllerResponse
A parsed reply from a controller (from the doc sandbox or an email/webhook).
- `id`, `requestId`, `receivedAt`, `channel`, `rawDocumentRef` (purged after normalisation window),
  `structured` (JSONB: categories held, sources, recipients, retention, decision), `parseConfidence`,
  `reviewedByHuman` (bool).
- **Invariant:** a response may not move a request to `COMPLIED`/`REFUSED` on parser output alone below a
  confidence threshold — requires deterministic validation or `reviewedByHuman`.

### EvidenceRecord  (tamper-evident)
- `id`, `requestId`, `kind` (`OUTBOUND_COPY | SCREENSHOT | POSTAL_PROOF | RESPONSE_COPY`),
  `sha256`, `prevHash` (chain), `qualifiedTimestampRef`, `storageRef`, `createdAt`.

### (Deferred, model later) Canary, SiteVerdict, ScoreFile
Placeholders for Modules 2/4/5 — **not** in Phase 0. Do not create tables yet.

## Key relationships
- User 1—1 current Identity, 1—* Mandate, 1—* RightsRequest, 1—* SuppressionEnrolment, 1—* FraudMarkerFiling.
- Identity 1—1 current IdentityPacket.
- Controller 1—* Playbook, 1—* RightsRequest.
- RightsRequest 1—* RequestEvent, 1—* ControllerResponse, 1—* EvidenceRecord,
  0—1 ProvenanceLedger (only for `ACCESS_ART15_SOURCE`), 0—1 supersedes → RightsRequest (self).
- ProvenanceLedger 1—* ProvenanceEntry.

## Retention & encryption (enforce in schema + app)
- `rawDocumentRef` blobs: purge after the normalisation window (e.g. 30 days) unless a dispute needs them.
- `IdentityPacket.storageRef`: purge once every referencing request is terminal and the dispute window has
  passed; keep the hash and the evidence link, never the image.
- Encrypt `Identity`, `IdentityPacket`, `ControllerResponse.structured`, and any credit data at rest with
  per-user envelope keys. Segregate the credit-file store and the identity-packet store.
- `RequestEvent` and `EvidenceRecord` are append-only (no updates/deletes; corrections are new rows).
