# 10 — Utility roadmap: from safe engine to score & privacy impact

**Status: PROPOSAL (2026-08-09).** Research-grounded plan for what to build next to maximise real user
utility — measured as verified credit-file improvements and verified privacy outcomes — plus the
open-source and vendor leverage that shortens the build. It does **not** resolve anything in
`ARCHITECTURE-DECISIONS.md` §3, and it does not change the normative clock/safety rules; where research
suggests a normative file needs updating, that is flagged as a counsel-gated proposal, never edited
silently. Scope/ordering authority remains `docs/09` (ADR-023); this file slots concrete workstreams
into that frame.

Method: full repo/spec audit (2026-08-09), the market report (retrieved 2026-08-02), and three
parallel research passes with claim-level sources — (A) subject-side OSS/public-data landscape,
(B) German credit-bureau law and score mechanics as of Aug 2026, (C) engineering building blocks.
Load-bearing URLs are inline; verify before legal use.

---

## 1. Current capabilities — honest baseline

Executable today: `pnpm -r build && pnpm -r test` and the `tools/spec-audit` CI harness. **Nothing
serves HTTP, persists, sends, or parses.** There is no NestJS bootstrap/AppModule, no Prisma adapter
behind `RequestsRepository` (port only), no workflow runner behind `WorkflowEngine`, no provider
implementation (postal/QTSP/ident/mailer/inbound/model are stubs), no UI, no seed loader, no auth.

What exists is genuinely strong and must be protected, not rebuilt:

- Contradiction-free spec kit (docs/00–09, state machine, playbook schema) with CI conformance and a
  spec-sync test binding code to the normative transition table in both directions.
- `packages/core`: pure domain — 16-state machine with the provable-clock structure (ADR-012),
  self-excluding idempotency with cycle dimension (ADR-013), branded unconstructible `RequestSubject`
  (ADR-019), playbook engine, evidence hash chain, provenance ledger logic with human-gated follow-ups.
- `packages/db`: full Prisma schema + SQL invariants (deadline CHECK, append-only triggers).
- `services/doc-sandbox`: injection-marker safety envelope; parser output advisory-only (ADR-021).
- 4 German templates (counsel-pending), 5 playbooks (all `active: false`), ~14-controller census in
  docs only.

**Consequence:** current user utility is zero by construction, and even once dispatch works, the
flagship's first user-visible *result* arrives only after a controller replies (~30–60 days).
The roadmap therefore optimises two things at once: (a) boot the engine to its first provable send,
and (b) create a **same-day utility surface that needs no counterparty** — see §3.1.

## 2. What actually moves a score, what actually moves privacy (verified Aug 2026)

### 2.1 Score levers — ranked by impact × prevalence × certainty

The new SCHUFA score shipped **17 March 2026**: scale 100–999, twelve published criteria
(~25% of partner companies migrated at launch; Branchenscores still co-exist). Published weights:
Zahlungsstörungen **max 264/999**; Girokonto/Kreditkarten-Anfragen+Abschlüsse 12mo **117**;
non-bank inquiries 12mo **99**; age of current address **94**; oldest credit card **81**; oldest bank
contract **69**; new instalment loans 12mo **66**; longest residual term **61**; mortgage **55**;
completed identity verification **38**; newest Rahmenkredit **36**; credit status **19**.
(Verbraucherzentrale: https://www.verbraucherzentrale.de/wissen/vertraege-reklamation/kundenrechte/neuer-schufascore-die-wichtigsten-infos-123061;
criteria table: https://www.capitalo.de/kredit/ratgeber/schufa-score)

| # | Lever | Legal basis / mechanism | Score relevance | Certainty |
|---|---|---|---|---|
| S1 | **Settled-claims deadline engine** — delete negative entries past CoC deadlines: 3y settled claims; **18 months** where settled ≤100 days after first report + no further negatives (live at Schufa since 1 Jan 2025; ~120k entries shortened, ~56k deleted) | CoC IV.1b (EDPB text: https://www.edpb.europa.eu/system/files/2024-06/240517_coc_dw_final_de.pdf); HBDI: https://datenschutz.hessen.de/presse/engagement-des-hbdi-zahlt-sich-aus-schufa-speichert-ausgeglichene-forderungen-nur-noch-18-monate | Directly attacks the 264-pt criterion | High — deterministic dates; BGH I ZR 97/25 (18 Dec 2025) upheld the CoC framework while allowing case-by-case "besondere Umstände" arguments |
| S2 | **Wrong/premature negative-entry disputes** — formal-prerequisite checks (undisputed? properly dunned? titled?), Art. 16 dispute to bureau + reporting creditor; Klärungsfall freezes the contested entry during investigation | Art. 16/5(1)(d); damages anchors BGH VI ZR 183/22 (28 Jan 2025, €500) and VI ZR 67/23 (13 May 2025, economic harm) | 264-pt criterion; error prevalence high (legacy 46% figure, GP Forschungsgruppe 2010; HBDI Auskunftei complaints +221% in 2025) | High |
| S3 | **RSB / insolvency cleanup** — Restschuldbefreiung flag deleted at 6 months (CJEU C-26/22+C-64/22; Schufa practice since 28 Mar 2023) **and all claims covered by the proceedings** (CoC IV.2b); Schuldnerverzeichnis early end via court Löschbescheinigung (IV.2a) | CoC IV.2; CJEU C-26/22 | Massive reset for affected users (~100k RSB/yr) | High — date-deterministic |
| S4 | **Refusal-response pack** — after a score-based refusal: Art. 15(1)(h) individualized logic disclosure (data used, per-element weighting, classification reason) + Art. 22(3) human review/contest | CJEU C-634/21; C-203/22 (27 Feb 2025, trade secrets no blanket excuse); VG Wiesbaden 6 K 788/20.WI (19 Nov 2025) ordering exactly this against Schufa | Enabler: surfaces what to fix; statutory hardening via **§ 37a BDSG in force 20 Nov 2026** (BGBl. I Nr. 139/2026) | High |
| S5 | **Inquiry hygiene** — Kreditanfrage→Konditionsanfrage recoding disputes; CoC IV.6 early deletion of inquiry data **on request after 12 months** | CoC IV.6 (on-request right) | 117+99-pt criteria | High |
| S6 | **Fraud repair** (Fraud Shield → File Fixer) — dispute fraud-caused entries; BGH-required individualised deletion case | Art. 16/17; BGH I ZR 97/25 balancing | 264-pt criterion; heaviest per-case harm | Medium-high (per-case) |
| S7 | **Provenance purge at infoscore** — broker-sourced address/neighbourhood layer enters its score by its own Art. 14 notice | Art. 15(1)(g) → 17(1)(d) chain; Austrian DSB/BayLDA precedent | Real but narrower; also the strategic flagship | Medium (answers today are generic) |

**Score guardrails (must-build, not optional):** two CoC rights are privacy-positive but
**score-negative** — IV.3a early deletion of terminated contract data (destroys oldest-contract/card
ballast, up to 81+69 pts) and aggressive address-history pruning. The product must warn before these
actions (docs/05 §3: accuracy/timing/informed choice, never promised numbers). Encode the 12-criteria
table as data so warnings are computed, not hand-written.

**Watch item (schedule now):** § 37a BDSG (in force **20 Nov 2026**) bans address data, age, gender,
name, social-network and account-flow data from scoring (LSP: https://www.lspartner.de/blog/2026/umsetzungsgesetz-verbraucherkreditrichtlinie).
Schufa's "Alter der aktuellen Adresse" (94 pts) is in visible tension — plan a criteria re-audit and
template re-check for Nov 2026. `TODO(counsel)`.

### 2.2 Privacy levers

P1 Werbewiderspruch fan-out (Art. 21(2), unconditional) to the named-broker set — highest win rate;
P2 provenance cascades (bureau 17(1)(d) + broker 21/17 — the noyb-vs-CRIF/AZ-Direct pattern, live in
Vienna since Dec 2023); P3 suppression enrolment — DDV Robinsonliste (ichhabediewahl.de, 5-year
validity) **and** I.D.I. Robinsonliste (robinsonliste.de: separate email/phone/mobile/post/fax lists,
unlimited validity; no bevh list exists) + renewal jobs; P4 directory/self-serve routes (JustDeleteMe
corpus); P5 breach-driven prioritisation (HIBP); P6 alias prevention (with the checkout-decline
caveat); P7 Melderegister Übermittlungssperren (BMG) as a one-time guided prevention flow; P8 the two
Deutsche Post entities' objections (BlnBDI publishes a ready-made letter for Deutsche Post Direkt;
its Werbewiderspruch propagates into the DDV list; **objection and erasure are mutually exclusive
there** — playbook already models the trap).

### 2.3 Escalation reality check (changes the ladder)

- **DPA complaints are slow pressure, not fast relief**: the flagship Schufa transparency case took
  5 years and a court order against the HBDI itself; **no fine against any German bureau 2024–2026
  was found**. Effective rungs are courts, CoC renegotiation — and:
- **NEW cheap rung — the CoC monitoring body.** TIGGES DCO GmbH (accredited by LDI NRW) runs a
  **free complaints portal for retention-period violations**, no lawyer needed; bureaus must respond;
  repeated violations threaten CoC exclusion: https://auskunfteien.beschwerdestelle-tigges-dco.de/.
  This slots between "letter refused/ignored" and "Art. 77 draft" for S1/S3/S5 cases, and it is not
  in `docs/08` today. **It preserves invariant 3**: model it as an `escalationVenue` property of the
  drafted complaint (`SEAT_DPA | COC_MONITORING_BODY`), same human-gated `ESCALATION_DRAFTED →
  humanSend → ESCALATED` edge — no state-machine change.
- **Art. 82 damages** (€500 anchored; more with proven economic harm) belong in dispute letters as
  settlement pressure and, as actual claims, behind the RDG partner-lawyer boundary (`docs/05` §2).

### 2.4 Legal environment deltas the specs don't know yet

1. **BAG 30 Jan 2025 – 2 AZR 68/24:** Einlieferungsbeleg + tracking status alone do **not** create
   prima-facie proof of delivery for Einwurf-Einschreiben; the **reproduction of the
   Auslieferungsbeleg** (retrievable by the sender from Deutsche Post within 15 months) does
   (https://www.brak.de/newsroom/news/anscheinsbeweis-bag-einwurf-einschreiben-beweist-nicht-den-zugang/).
   → The evidence pipeline needs a **post-send retrieval job**: fetch the Auslieferungsbeleg
   reproduction, hash, QTSP-anchor, attach as `EvidenceRecord` (new kind `DELIVERY_PROOF`).
   `TODO(counsel):` whether `provableSendConfirmed` (the `deadlineAt` trigger in CLAUDE.md §6 /
   docs/05 §6 / state-machine — one rule, three places) should key on Einlieferung or on retrieved
   Auslieferungsbeleg; and, for hybrid mail, contractually who the formal Einlieferer is and that
   the Beleg passes through. **Do not change the three files until counsel decides.**
2. **Digital Omnibus status:** the AI part passed (OJ 24 Jul 2026); the **GDPR/Data part is NOT
   adopted** (Council compromises dropped several headline reforms; adoption "late 2026 at the
   earliest"). The Art. 15 "excessive/abusive" refusal clause remains directionally live: keep every
   request individual, user-initiated, data-protection-purposed (already our architecture), avoid
   "credit-optimisation" framing for access requests in copy, and add a **structured rebuttal
   template** for a controller answering "excessive/abusive" (a `REFUSED`-path template, not a new
   state).
3. **Vollmacht formalities:** OLG Stuttgart demanded an original PoA from a representative; the
   Hessian DPA published PoA requirements (Apr 2026:
   https://www.delegedata.de/2026/04/hessische-datenschutzbehoerde-anforderungen-an-die-vollmacht-zur-ausuebung-von-betroffenenrechten/).
   → Mandate/QES flow must render a controller-facing artifact that survives challenge. `TODO(counsel)`.
4. **Fraud-marker facts:** Schufa Einmeldung requires ID copy + **Strafanzeige with Aktenzeichen**,
   retention 4 calendar years, no score effect, early deletion on request
   (https://www.schufa.de/kontakt/einmeldung-identitaetsbetrug/). CRIF has the DSPortal filing
   (https://www.crif.de/fuer-privatpersonen/identitaetsbetrugsmeldung/). **infoscore/Experian and
   Boniversum have no public victim process** — direct-inquiry templates needed. **No credit freeze
   exists in Germany**; the product synthesises freeze-like value (flag + monitoring + rapid dispute)
   and must never market it as a freeze.
5. **Postal cost update:** LetterXpress Einwurf-Einschreiben surcharge is €3.41 net / €4.06 gross on
   top of the base letter (≈€4.20–4.50 all-in), vs docs/06 H7's €3.30 assumption — re-baseline the
   postal cost model when H7 is next revised (flag only; H7 not edited here).

## 3. The plan

Ordering logic: ADR-023 keeps the provenance loop as M1 — it proves the whole engine (send → parse →
escalate) and its targets are the thesis. This roadmap adds one structural insight and three
workstreams around it.

### 3.1 The sequencing insight: "bring your own Datenkopie" (BYO ingest)

The report (§9.3) already notes the Datenkopie-ingest pipeline is "built once, used by both" File
Fixer and Provenance. Build the **ingest side first against user-uploaded documents**: most target
users can obtain (or already hold) a Schufa/CRIF/infoscore Datenkopie; parsing it into a normalised
credit file and running the deterministic CoC rules engine delivers **same-day, score-relevant
findings** — before any outbound letter clears the counsel gate, and while the provenance loop waits
out its statutory month. It also de-risks the hardest engineering component (German bureau-document
parsing) with real documents on day one.

Read-only by design: findings + prepared drafts; every outbound action still flows through the
existing guarded pipeline once templates are counsel-approved.

**Safety invariant (non-negotiable, same class as `IdentityPacket`):** an uploaded document is
ingested **only after** the parsed name + DOB match the `VERIFIED` Identity; mismatch → reject and
purge, never "ingest anyway". This must not become a third-party-file ingest path (CLAUDE.md
"one rule"). Uploads are rate-limited and logged for anomaly review. `TODO(safety):` threat-model the
upload endpoint (a document *about someone else* must be unrepresentable in the normalised store —
bind `CreditFileSnapshot.identityId` and assert at write).

### 3.2 Phases

Team assumption: 2–3 engineers + Claude Code. Phases overlap deliberately; each names an exit
criterion. Counsel workstream (§5) runs in parallel from day one and gates all real sends.

**P0 — Boot the engine (≈ docs/01 M0 completion; weeks 1–3)**
- NestJS AppModule + bootstrap; Prisma adapter implementing `RequestsRepository`; invariants
  migration applied; auth (email + TOTP MFA; step-up stub); config plumbing per `.env.example`.
- Workflow runner behind `WorkflowEngine` (ADR-004). Research recommendation **for an ADR decision,
  not decided here**: prefer **pg-boss** (Postgres-native, transactional with the ledger) over BullMQ
  for M0/M1, Temporal self-hosted as the target (EU/in-VPC; months-long durable timers are its
  designed case; pin deadline workflows under Worker Versioning).
- **Census import tool**: ingest `github.com/datenanfragen/data` (CC0-1.0) — the curated German packs
  (their company-packs de.json: 7 credit agencies, 13 address brokers), per-company `required-elements`,
  fax/postal channels, and the **57-DPA machine-readable directory** → `Controller` rows with
  provenance (`sources`, `quality`) retained. Import ≠ activation: every playbook stays
  `active: false` behind the ADR §4 checklist; re-verify channels before enabling (their `quality`
  is mostly "verified", not "tested"; a bounced send is a false start).
- Evidence ledger live: hash chain (exists) + EU S3 object-lock storage + `Timestamper` stub.
- Exit: dev E2E — create → guards → render → stub-dispatch → stub-parse → transition, all persisted.

**P1 — First provable send: the provenance flagship (≈ M1; weeks 3–7)**
- `PostalProvider`: **LetterXpress LXP API v3** (instant signup, sandbox, `r1` Einwurf-Einschreiben;
  ~€4.20–4.50/letter) + rendering via **datenanfragen `letter-generator`** (MIT, DIN 5008 windowed
  layout) — resolves OQ-7's mechanics either way OQ-7 is decided (renderer supplies the envelope).
  Evaluate Binect / Deutsche Post E-POST API in parallel for Auslieferungsbeleg chain-of-custody.
- **Auslieferungsbeleg retrieval job** per §2.4(1), new `EvidenceKind` `DELIVERY_PROOF`.
- `Timestamper`: **InfoCert qualified timestamps via Openapi** (~€0.10/stamp, REST, instant start;
  D-Trust contract track in parallel for German-court optics). Anchor clock-critical events
  individually + hourly Merkle root over the ledger (RFC 4998 pattern); store per-event inclusion
  proofs.
- `DocSandbox` real parser v1: **Docling (MIT)** for OCR/layout/tables + **Mistral Document AI (EU,
  JSON-schema structured output)** behind `ModelProvider` — both inside the isolated service,
  existing safety envelope unchanged. (Claude via Bedrock eu-central-1 / Vertex europe-west4 as the
  quality alternative if hyperscaler-EU is acceptable; avoid Surya/Marker — NC-ish licensing.)
- `IdentityProvider`: **POSTIDENT SCR API** as multi-channel default (eID + video + photo +
  **post-office branch** — the branch channel serves exactly the low-digital-confidence users of the
  docs/09 gate); Governikus AusweisIDent as cheap eID-only alternative; leave an EUDI-Wallet adapter
  slot (German wallet Jan 2027; private-sector acceptance duty Dec 2027).
- Provenance E2E vs infoscore + Schufa per existing playbooks (activation itself stays counsel-gated,
  OQ-8), plain UI: request list, pipeline states, **both clocks labelled** (provisional ≠ statutory).
- Exit: acceptance criteria of docs/01 M1 achievable end-to-end with real providers in staging.

**P1.5 — BYO-Datenkopie ingest + File-Health findings (parallel; weeks 4–9)**
- New entities (Prisma deltas, names indicative): `CreditFileSnapshot` (userId, identityId, bureau
  controllerId, sourceKind `UPLOAD | RESPONSE`, receivedAt, matchAssertedAt) → `CreditFileEntry`
  (entryType enum: NEGATIVE_CLAIM, CONTRACT, INQUIRY, ADDRESS, INSOLVENCY, SCORE; reportedBy,
  reportedAt, settledAt, disputedFlag, raw refs) → `FileFinding` (ruleId, **ruleSetVersion**,
  severity, computedDeadlineAt, recommendedAction, scoreRelevance, `scoreNegativeWarning` bool,
  evidenceRecordId).
- **Retention/error rules engine** in `packages/core` (pure, exhaustively unit-tested — CLAUDE.md
  "tests first"): CoC IV.1a/b (3y; 18mo/100-day), IV.2a/b (Schuldnerverzeichnis; RSB 6mo + covered
  claims), IV.3a (contract data 3y; on-request early deletion **with score warning**), IV.4
  (addresses 3/6y), IV.5 (fraud-suspicion 3y), IV.6 (inquiries; on-request after 12mo), inquiry-type
  misclassification, settled-without-Erledigt, disputed-when-reported. Rule set is **versioned,
  effective-dated, counsel-signed** like templates — the CoC runs to 25 May 2030 with revisions
  possible, and § 37a lands 20 Nov 2026.
- 12-criteria score table as data (`ScoreCriterion`) powering guardrail warnings and "what likely
  matters in your file" ordering — no score predictions, no promises (docs/05 §3).
- Findings surface (plain UI): file-health list + prepared draft actions; red/amber/green dial visual
  arrives with the P4 gate.
- Exit: a verified user uploads a real Schufa Datenkopie and sees deterministic findings the same day;
  identity-mismatch uploads are rejected and purged (tested).

**P2 — File Fixer actions + Werbewiderspruch breadth (≈ M2/M2.5; weeks 7–12)**
- New templates (counsel): Art. 16 dispute (bureau + reporting creditor variants, Klärungsfall
  framing, Art. 82 pressure clause), CoC retention-deletion demand, inquiry-recode dispute, CoC IV.6 /
  IV.3a on-request deletions (the latter behind the score warning), RSB cleanup demand,
  15(1)(h)+22(3) refusal pack (C-203/22 / VG-Wiesbaden language), excessive/abusive rebuttal (§2.4(2)).
  Start from **datenanfragen CC0 German templates** (incl. their Mahnung `admonition.txt` and Art. 77
  `complaint.txt`) as counsel's redline base.
- `RefusalEvent` intake for S4 (user reports an adverse decision; recipient is the *lender* —
  a controller possibly outside the census). `TODO(safety):` the lender address is user-entered
  controller data, not subject data — constrain to organisation addresses, validate, rate-limit.
- Escalation venue extension per §2.3: `escalationVenue: SEAT_DPA | COC_MONITORING_BODY` on drafted
  complaints (TIGGES for retention cases); graph unchanged, `ESCALATED` keeps exactly one inbound
  edge.
- Werbewiderspruch fan-out to the named-broker set (AZ Direct, Acxiom, Deutsche Post Direkt,
  Deutsche Post Adress, Capaneo/Schober, eGENTIC …) using census channels; Robinsonliste (DDV +
  I.D.I.) enrolment + renewal job; fresh `ACCESS_ART15` Datenkopie loop to all three bureaus feeding
  P1.5 ingest.
- Cheapest-rung-first routing + `LeverageAction` telemetry wiring (docs/08): every action writes one
  row with honest cost.
- Exit: docs/01 M2 criteria + first verified retention deletions in staging fixtures; disputes ready
  to send pending counsel.

**P3 — Fraud Shield one-flow (weeks 10–14)**
- Guided flow: Strafanzeige guidance + **Aktenzeichen capture** → Schufa Einmeldung (guided; form is
  bot-gated — guided handoff, not automation) + CRIF DSPortal filing → `FraudMarkerFiling` state
  tracking, 4-calendar-year expiry + optional early-deletion scheduling; direct-inquiry templates to
  infoscore/Boniversum (no public process — `TODO(counsel)`).
- Monitoring: `BreachMonitor` interface — **HIBP** (Core tier to start; Pro $379/mo unlocks
  k-anonymity range search, preferable so full emails never leave our boundary; CC BY 4.0 attribution
  required; **never ingest raw breach dumps** — §202d StGB exposure; XposedOrNot as MIT fallback).
  `TODO(counsel):` Art. 44 ff. transfer assessment for HIBP queries.
- Point users to the free bureau-side monitors (Schufa IdentSafe, bonify 24h alerts) as the
  freeze-substitute bundle; treat bonify strictly as an external, untrusted surface.
- Fraud-caused entries hand into the P2 dispute engine (BGH individualised-case pattern).
- Alias issuance only if capacity: self-hosted **unmodified SimpleLogin** (AGPL kept outside our
  codebase via network boundary), inbound-forwarding-only on a clean EU VPS; checkout-decline caveat
  surfaced pre-issuance; do not let mail-ops steal weeks from the request pipeline.
- Exit: a fraud victim completes the full flow in staging; markers tracked with expiry.

**P4 — Usability gate (launch-blocking, before real users; weeks 12–16)**
Unchanged from docs/09 §gate: per-module user-action-flow diagrams; visual components (data-flow map,
file-health dial, pipeline with live statutory countdown — provisional clocks visually distinct);
B1 German + Leichte Sprache + one-tap jargon explainers; WCAG 2.2 AA + axe in CI; "every screen
states the next action" in DoD. POSTIDENT's branch channel is part of meeting this gate.

**Explicitly still deferred** (unchanged): public scoreboard (Tier 3), canary attribution graph,
browser extension, L2 browser agents (see §4.8 — email-first / guided handoff / future Web Bot Auth
signed-agent route; never stealth anti-bot bypass, never CAPTCHA services), bulk Art. 15 sweeps.

### 3.3 Decisions this plan needs from humans (feed into ARCHITECTURE-DECISIONS §3; not resolved here)

| Proposed OQ | Question | Owner |
|---|---|---|
| OQ-11 | Provable-send definition after BAG 2 AZR 68/24: does `deadlineAt` key on Einlieferung or retrieved Auslieferungsbeleg? (touches the one-rule-in-three-places) | counsel + product |
| OQ-12 | Workflow runner for M0/M1: pg-boss vs BullMQ (ADR-004 names BullMQ; ledger-in-Postgres argues pg-boss); Temporal timing | engineering |
| OQ-13 | CoC rules engine sign-off process: who approves a rule-set version, and the § 37a (20 Nov 2026) re-audit owner | counsel |
| OQ-14 | RDG boundary for S2/S6 disputes and Art. 82 assertion in letters: messenger-service framing vs Inkasso/partner-lawyer routing | counsel |
| OQ-15 | BYO-upload identity-match policy details (match thresholds, mismatch retention = immediate purge, appeal path) | safety |
| OQ-16 | HIBP data-transfer assessment + tier choice (Core direct-email vs Pro k-anonymity) | counsel + engineering |

## 4. Open-source & vendor leverage map

| Need | Pick (license) | Why / notes |
|---|---|---|
| Census seed | **datenanfragen/data** (CC0-1.0) | 1,904 German controller records; curated DE packs incl. all bureau targets; `required-elements` per company; 57-DPA directory; obsolete-record redirects (Schober→Capaneo, Boniversum→infoscore). Ingest, retain provenance, re-verify before activation |
| German legal text base | **datenanfragen templates** (CC0-1.0) | Access/objection/erasure/rectification + **Mahnung + Art. 77 complaint**; counsel redlines these, not blank pages |
| Letter PDF/DIN 5008 | **letter-generator** (MIT) | Dormant-but-small; vendor and own |
| Registered post | **LetterXpress** API v3 (commercial) | Instant start, sandbox, Einwurf `r1`; Binect / DP E-POST for Beleg chain-of-custody track |
| Qualified timestamps | **InfoCert via Openapi** (commercial, ~€0.10/stamp) | Instant API; **D-Trust** as German-optics upgrade; hourly Merkle anchoring (RFC 4998) + individual stamps for clock-critical events; DigiCert/Sectigo public TSAs are NOT eIDAS-qualified |
| Doc parsing (OSS) | **Docling** (MIT) | 2026 best-in-class layout/tables permissively licensed; Tesseract deu as cheap fallback; avoid Surya/Marker (restrictive model licence), unstructured *platform* (US) |
| Doc parsing (EU LLM) | **Mistral Document AI** (EU, JSON-schema output) | Behind `ModelProvider`; Claude on Bedrock eu-central-1 / Vertex europe-west4 as alternative; IONOS/STACKIT/OVH/Scaleway if counsel demands EU-owned |
| Identity | **POSTIDENT SCR** (commercial) | Multi-channel incl. post-office branch (usability gate); Governikus AusweisIDent for cheap eID; EUDI adapter slot for 2027 |
| Workflows | **Temporal** self-hosted (MIT) target; **pg-boss** (MIT) interim (OQ-12) | Months-long durable timers designed-for; EU/in-VPC |
| Evidence ledger | Postgres append-only + triggers (already spec'd) + S3 object lock | immudb adds ops without removing QTSP need; sigstore/rekor public log is a GDPR liability |
| Breach signal | **HIBP** (commercial; CC BY 4.0 attribution) | Only legally safe feed; k-anonymity on Pro; XposedOrNot (MIT) fallback; raw dumps = §202d StGB risk |
| Self-serve routes | **JustDeleteMe / JustGetMyData** (MIT) | 2,582 deletion routes with `notes_de`; Tier 0/1 ladder content |
| Aliases (later) | **SimpleLogin** self-host unmodified (AGPL, isolated) | Network boundary = licence boundary; inbound-only first |
| Architecture reference | **Ethyca Fides** (Apache-2.0), **OpenDSR** spec (Apache-2.0) | Controller-side lifecycle/webhook prior art; our clock semantics stay bespoke |
| Not usable | Optery directory, BADBOOL (CC BY-NC-SA); GDPRhub (NC — internal research only); Eraser (no licence); OpenSCHUFA code (archived; pre-2025 layouts) | Recorded so nobody re-litigates them |

Deliberate non-goals confirmed by research: web-form automation via stealth/CAPTCHA bypass (legal
grey zone + our own rules); the durable legitimate route is **email-first → guided handoff with
evidence capture → (later) extension copilot in the user's own session → IETF Web Bot Auth
"signed agent" registration** as adoption spreads (https://blog.cloudflare.com/web-bot-auth/).

## 5. Counsel workstream (blocks sends, not builds)

Existing: OQ-7 (letter envelope — P1 resolves mechanics via renderer either way), OQ-8 (infoscore
Art. 14 V7 verification), OQ-9 (`minReExerciseDays`), OQ-10 (IdentityPacket route/redaction,
§20 PAuswG). New from this research: OQ-11–OQ-16 (§3.3), plus template sign-offs for the P2 set, CoC
rule-table sign-off (v1), fraud direct-inquiry letters, Vollmacht artifact per Hessian-DPA
requirements, and marketing-copy review (no freeze claims, no score promises, access requests framed
on data-protection purposes — Digital-Omnibus posture).

## 6. Metrics (extends docs/00 targets)

- **Time-to-first-value < 1 day** via BYO ingest (new; was ~30–60 days structurally).
- Findings yield: % of ingested files with ≥1 deterministic finding (error-prevalence proxy).
- Verified deletions/corrections at 90 days (target >60% with escalation; noyb 16.5% baseline).
- % actions resolved on Tier 0/1 rungs (cheapest-rung doctrine); cost per completed action
  (<€0.50 digital / <€1.50 postal-heavy; postal unit now ~€4.20–4.50 with Beleg retrieval on top).
- Fraud flow completion rate (victims completing Einmeldung; baseline: only 9% notify Schufa).
- Zero identity-binding violations; zero auto-sent escalations; zero statutory deadlines asserted
  from non-provable sends (existing invariant tests + CI).

---

# 7. Addendum — the recruitment / workforce / AI-background-check controller layer

**Added 2026-08-09 (research round 2).** A distinct controller class the census does not model today:
the `ControllerType` enum is `CREDIT_BUREAU | ADDRESS_TRADER | DIRECTORY | ECOMMERCE | OTHER`, with no
recruitment/HR/screening value. This layer harvests a German professional's data for hiring, sourcing
and "background" purposes — and, unlike the marketing brokers, its highest-yield members mostly offer
self-serve opt-outs, so it slots onto the **existing leverage ladder and rights engine** rather than
needing new machinery.

**Sourcing caveat (this round was degraded):** the round-2 research agents fanned out and hit a
session usage limit; most sub-agents failed. The facts below were re-verified directly (URLs inline);
the self-exposure-scan OSS evaluation (§7.5) completed in full. Items marked **[verify]** are breadth
gaps to re-run (exact opt-out URLs for the long-tail brokers; the precise per-record datenanfragen
coverage; the German seat-DPA for each EU-established vendor).

## 7.1 What is at high risk of being collected

Rows are data categories; "primary instrument" is the cheapest effective removal route (see §7.3).

| Data category | Collected by | Source | Sensitivity | Typical DE-professional exposure | Primary instrument |
|---|---|---|---|---|---|
| Name, employer, job title, **work email** | B2B enrichment brokers; ATS | scraped LinkedIn/Xing + user-uploaded contact lists | Low–med | Very high (anyone on LinkedIn/Xing) | Broker self-serve opt-out → Art. 17 |
| **Personal mobile / private email** | ZoomInfo, Apollo, Lusha, Cognism, People Data Labs, RocketReach, ContactOut, SignalHire | scraped + "crowdsourced" from customers' address books/phone contacts | **High** (private contact data, not chosen for publication) | High for anyone whose number sat in a colleague's phone | Art. 17 erasure + suppression-list; Art. 21(1) |
| Home/postal address | some enrichment brokers; screening firms | broker-bought, public records | High | Medium | Art. 17; Art. 15(1)(g) source trace |
| Full career history / CV | ATS/HCM (Workday, SAP SuccessFactors, Personio, softgarden, Greenhouse, iCIMS…) | supplied by the applicant | Med | Everyone who ever applied | Art. 17 after the ~6-month retention limit (§7.4) |
| Social-media content / inferred private-life views | AI/social-screening tools (Fama, Ferretly); recruiter manual checks | scraped public posts | **High** | Medium | Unlawful at source in DE for private networks (§7.4) → Art. 17 + complaint |
| Inferred personality / "culture fit" / psychometric scores | HireVue, Retorio (DE), Pymetrics, Sapia, Eightfold | derived from interviews/tests | **High** (Art. 22 automated decision) | Rising; common in volume hiring | Art. 22(3) human review + Art. 15(1)(h) explanation + Art. 17 |
| Voice / facial analysis (video interviews) | HireVue-type; some ATS video modules | biometric-adjacent processing | **Very high** (Art. 9) | Growing | Art. 9 unlawfulness argument + Art. 17 |
| Criminal-record / credit signals | background-screening firms (HireRight, Sterling, First Advantage, Accurate) | official registers, bureaus | **Very high** (Art. 10) | Low in DE (tightly restricted, §7.4) | Challenge lawfulness → Art. 17 |
| References, salary history | ATS; screening firms | employer/reference-supplied | Med–high | Medium | Art. 17; accuracy (Art. 16) |
| Breach / stealer-log exposure feeding hiring-fraud | (feeds Fraud Shield, not a hiring controller) | leaks | High | High | HIBP monitor (docs/10 §3 P3) + self-exposure scan (§7.5) |

**The single biggest exposure is the B2B enrichment-broker layer**, because it collects **private**
contact data (personal mobile, private email) that the subject never published, largely by scraping
LinkedIn/Xing and ingesting customers' uploaded address books — and it is the layer with the clearest
illegality finding (§7.2) and the easiest removal route (§7.3).

## 7.2 The flagship precedent: KASPR (CNIL, €240,000)

CNIL fined **KASPR €240,000** (decision 5 Dec 2024; EDPB notice 2025) — a Cognism-owned Chrome-extension
B2B contact broker with ~160M contacts — for: collecting LinkedIn users' contact details that had
**restricted visibility** (1st/2nd-degree only); **over-retention**; and **no transparency** (no Art. 14
notice until 2022, then English-only). Cease order + compliance by 18 June 2025.
(https://www.cnil.fr/en/data-scraping-kaspr-fined-eu240000;
https://www.edpb.europa.eu/news/news/2025/data-scraping-french-supervisory-authority-fined-kaspr-eu240-000_en)
This is the direct analogue of the bureau/broker provenance play: **scraping professional networks to
build a sellable contact database on non-consenting EU subjects is unlawful processing**, giving every
German subject a strong Art. 17 erasure + Art. 21(1) objection claim, with Art. 14 notification-breach
as escalation material. It is to this layer what the Austrian-DSB/BayLDA CRIF rulings are to the bureaus.

## 7.3 How it can be removed — routes (cheapest rung first)

Per docs/08, prefer the controller's own off-switch over legal artillery. This layer is unusually
opt-out-friendly, so most removals are **Tier 1 (self-serve)**, escalating to Art. 17/21 only on
non-response.

- **ZoomInfo** — self-serve removal at `privacyrequest.zoominfo.com/remove/verify` (work email + 4-digit
  code; 24–72h, up to 14 days); Privacy Center "Do Not Sell or Share"; honors GDPR erasure.
- **Apollo.io** — Privacy Center opt-out; or email `privacy@apollo.io` citing **Art. 17**; 24h–7–10
  business days; **must also request the suppression list** or its "crowdsource contributors" re-add you.
  (datenanfragen record confirmed: slug present, runs ZenLeads/ZenProspect.)
- **Cognism** — Privacy Centre request + email verification; removed within **120 hours**.
- **People Data Labs** — `peopledatalabs.com/do-not-sell-or-share` or emailed DSAR; confirm link 72h;
  ~14 days.
- **Lusha, RocketReach, Seamless.AI, ContactOut, SignalHire, LeadIQ, Kaspr, Wiza, Nymeria** — each has a
  self-serve privacy/opt-out form + emailed-DSAR fallback of the same shape **[verify exact URLs]**.
- **ATS/HCM (Workday, SAP SuccessFactors, Personio, softgarden, Greenhouse, iCIMS…)** — the ATS is a
  **processor** for the employer (controller); the effective route is an Art. 15/17 request to the
  **employer**, invoking the ~6-month post-rejection limit (§7.4). Guided handoff, not automation.
- **AI screeners (HireVue/Retorio/Pymetrics/…)** — Art. 22(3) human-review + Art. 15(1)(h) explanation
  (reuse the docs/10 §3 P2 **S4 refusal pack**) + Art. 17; Art. 9 argument where biometric.
- **Background-screening firms** — challenge lawfulness under the German limits (§7.4) then Art. 17.

**The reappearance problem (honest caveat, surface in-product):** B2B broker profiles are
"continuously re-aggregated from public sources", so a one-shot deletion often re-lists after the next
re-scrape. The tested posture is **claim-and-correct + suppression-list + periodic re-suppression**
(and source hardening at LinkedIn/Xing), monitored — the same monitoring-subscription logic as the core
product. Do not promise permanent deletion.

## 7.4 German/EU legal levers (verified Aug 2026)

- **§26 BDSG is on borrowed time.** CJEU **C-34/21** (30 Mar 2023) held the §26(1)-type basis
  incompatible with Art. 88 GDPR; BMI+BMAS published a **Beschäftigtendatengesetz (BeschDG)**
  Referentenentwurf on **8 Oct 2024** (repeals §26 BDSG, sharpens the applicant-phase question-right,
  regulates AI use with an AI-Act cross-reference). **Still only a Referentenentwurf as of ~May 2026 —
  not enacted.** (https://www.luther-lawfirm.com — BeschDG update; https://www.dr-datenschutz.de/beschaeftigtendatengesetz-inhalte-des-neuen-entwurfs/)
- **Applicant-data retention = deterministic deletion lever.** Rejected-applicant data may be kept only
  ~**6 months** after the process (AGG's 2-month claim window + 3-month litigation + buffer); after that
  Art. 17 deletion is due unless an AGG claim is pending or the applicant consented to a talent pool.
  This is a File-Fixer-style date rule against the **employer/ATS**.
  (https://www.dr-datenschutz.de/aufbewahrungsfrist-wann-sind-bewerbungen-zu-loeschen/)
- **Screening limits.** Professional networks (LinkedIn/Xing) are generally checkable if public and the
  applicant is informed; **private networks (Facebook/Instagram/TikTok) are off-limits** even when
  public (§26(1) necessity). Schufa/credit checks in hiring are near-impermissible (narrow exceptions);
  criminal record is Art. 10 + §§51, 53 BZRG (Verwertungsverbot) restricted; Art. 9 health data tightly limited. Unlawful
  screening → Art. 17 + Art. 77 complaint.
  (https://www.dr-datenschutz.de/bewerber-check-in-sozialen-netzwerken-was-ist-erlaubt/)
- **AI in hiring.** AI Act **Annex III recruitment/employee-management high-risk obligations postponed
  2 Aug 2026 → 2 Dec 2027** (Digital-Omnibus AI, in force 27 Jul 2026), **but** Art. 50 transparency +
  Art. 4 literacy stay on the original timeline, and **GDPR Art. 22 (automated-decision) and Art. 9
  (biometric) remain fully in force now**. So the usable levers against AI screeners today are GDPR, not
  the (deferred) AI-Act duties. NYC Local Law 144 is a bias-audit reference point, no German equivalent
  yet. (https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
- **Instrument choice matters — do NOT reuse the Art. 21(2) Werbewiderspruch template here.** Enrichment
  brokers process on Art. 6(1)(f) "legitimate interest" for *sales/recruiting intelligence*, which is
  **not direct marketing**. The correct instruments are **Art. 17 erasure** (unlawful scraping, KASPR),
  **Art. 21(1) objection** — which requires grounds arising from the data subject's particular
  situation (unlike the free-standing Art. 21(2)), and on which the controller bears the burden of
  proving compelling legitimate
  grounds), **Art. 15 / 15(1)(g)** to trace the source, and **Art. 14 notification-breach** as
  escalation. A new template `art21(1)-widerspruch.de` is needed; `art17-loeschung.de` is reused.
  `TODO(counsel)`.

## 7.5 OSS / tried-and-tested tooling

**Removal-corpus reuse (commercially clean):**
- **datenanfragen/data (CC0-1.0)** — already the census-import base (docs/10 §3 P0). Confirmed to carry
  enrichment-broker records (Apollo.io verified on datarequests.org; ZoomInfo/Lusha/Cognism/RocketReach
  **[verify per-record]**). Ingest verbatim, enrich privately, re-verify opt-out endpoints before use.
- **JustDeleteMe (MIT)** — self-serve deletion routes with `notes_de`, for the Tier-1 handoff.
- **NOT usable:** the **Optery data-broker directory** and **BADBOOL** cover this layer well but are
  **CC BY-NC-SA (NonCommercial)** — reference/gap-analysis only, never ingested. Consumer "EU broker
  opt-out link lists" exist but are unlicensed blog corpora, not reusable assets.

**Self-exposure discovery — the "where is my data / what would a background-checker find" scan
(full OSS evaluation completed this round):** there is a genuine open-source stack for the *discovery*
side, but it is **dual-use and must be hard-bound to the verified account holder** (CLAUDE.md's one
rule — the same anti-stalker constraint as `deriveSubject`). Recommended v1:
- **Breaches:** **HIBP API** (commercial, ToS *endorses* self-check and forbids the stalking use case;
  k-anonymity range endpoint keeps full emails in-region) — already in the Fraud-Shield plan.
- **Username footprint:** consume **WhatsMyName data (CC-BY-SA-4.0)** in our own TS checker, or run
  **sherlock/maigret (MIT)** as a gated sidecar **with the bundled "AI dossier/profiling" features
  disabled**.
- **Email→accounts:** **socialscan (MPL-2.0)**; optionally **holehe (GPL-3.0)** hard-gated (it emails
  the address — fine only for the user's own inbox).
- **Face:** treat web face-search as a **known OSS gap** — no open equivalent of PimEyes exists, and any
  such crawler is inherently arbitrary-subject; do **not** build one. `deepface` (MIT) can only match
  against images we already hold; `insightface` pretrained models are **non-commercial** — avoid.
- **REJECT for this product:** arbitrary-subject OSINT frameworks (`spiderfoot`, `recon-ng`,
  `theHarvester`, `phoneinfoga`, `GHunt`/AGPL) — built to profile *anyone*; self-binding is a bolt-on,
  not intrinsic. `blackbird` has **no root OSS license** (unusable). Never use residential-proxy
  rotation to evade rate limits.
- **Safety gate (non-negotiable):** every scan input (email, username, own selfie) is **derived from
  the verified Identity**, never a free-text subject; scan output is **advisory** and feeds a
  human-reviewed exposure report — it may not auto-open a removal request (it re-enters the guarded
  Art. 17/21 pipeline); rate-limit and anomaly-review. `TODO(safety)`.

## 7.6 Engine / census deltas — IMPLEMENTED 2026-08-09 (ADR-024)

Target #1 (enrichment brokers) is built to the repo's grain: pure-core logic + tests, counsel-pending
drafts, `active: false` playbooks, full spec-audit + 101/101 core tests green. What landed:

- **Classifications** (`packages/db`, migration `0002_recruitment_layer`): `ControllerType` +=
  `DATA_ENRICHMENT_BROKER | HR_TECH | AI_SCREENER | SCREENING`; `ControllerRole` += `ENRICHMENT_BROKER |
  EMPLOYER_PROCESSOR`.
- **`SelfServeRoute` (docs/08 Tier-1, previously unbuilt) is now real**: Prisma model +
  `packages/core/src/leverage/self-serve.ts` (`chooseCheapestRung()` cheapest-rung-first;
  `isGuidedOnly`; `assertNoCredential` guardrail) + `packages/core/src/leverage/broker-routes.seed.ts`
  (the six verified removal forms). Tests: `packages/core/test/self-serve.test.ts` and
  `packages/core/test/broker-routes.seed.test.ts` — a source-scan asserts the `SelfServeRoute` type
  carries no credential field (docs/08 guardrail 1).
- **Instrument = Art. 17 + Art. 21(1), verified** (`isDirectMarketing: false`; Werbewiderspruch is the
  wrong tool). New template `templates/art17-datenhaendler.de` (erasure led by Art. 17(1)(d) on the
  KASPR reasoning + the Art. 21(1)→17(1)(c) bridge). Playbooks: `loeschung.generic-datenhaendler`
  (stencil) + `loeschung.{zoominfo,apollo,lusha,cognism,peopledatalabs,rocketreach}`, all `active:false`,
  `onDeadlineExpiry: NONE` / `onRefusal: DRAFT_ART77` (US brokers have no provable silence clock).
- **Reused, not rebuilt** (still to wire when the app boots): the **File-Fixer retention-rule engine**
  for the ~6-month applicant-deletion rule against employers/ATS; the **S4 refusal pack** for AI
  screeners; the **HIBP monitor** for the breach-exposure feed.
- **Deferred:** the **Self-Exposure Scan** module (§7.5) — dual-use, so gated behind OQ-18.
- **New open questions (now recorded in ARCHITECTURE-DECISIONS §3):** OQ-17 (instrument/template
  sign-off — counsel), OQ-18 (self-exposure scan scope — safety+product), OQ-19 (email as a
  subject-identifier — safety+counsel), OQ-20 (Art. 77 venue / one-stop-shop nuance — counsel),
  OQ-21 (clock model for no-German-postal controllers — engineering+counsel).

**Update 2026-08-10 (ADR-025) — two follow-on builds landed:**
- **Cheapest-rung-first is wired into the request pipeline.** `planRequestCreation()` (pure core) maps
  `requestType → outcome` and prefers a Tier-1 self-serve route over a legal request;
  `RequestsService.create()` consults it before the legal flow and short-circuits to a guided handoff
  (recording a `LeverageAction`) when a route exists — source-scan-guarded so a legal request cannot be
  generated when a self-serve route achieves the outcome (docs/08 guardrail 5).
- **Target #2's applicant-retention rule engine is built.** `assessApplicantRetention()` (pure,
  versioned) encodes the AGG ~6-month rejected-applicant ceiling with the pending-claim and
  talent-pool-consent extensions; it states a fact, never a score. The bureau CoC schedule (§2.1 S2)
  remains a separate rule set. The create orchestration was extracted to a pure core `createRequest()`
  so the "no legal request when a self-serve route exists" guarantee is behaviourally tested. Core
  suite: 153 tests.

## 7.7 Top removal targets (harm × prevalence × ease)

1. **B2B enrichment brokers (ZoomInfo, Apollo, Lusha, Cognism, People Data Labs, RocketReach…)** —
   highest private-data harm, near-universal exposure, easy self-serve opt-out, and a live illegality
   precedent (KASPR). The clear #1; mostly Tier-1 work.
2. **Employer/ATS rejected-applicant data past 6 months** — deterministic date rule, concrete harm,
   guided handoff to the employer.
3. **AI screeners with automated decisions** — high harm (Art. 22), Art. 15(1)(h)/22(3) levers usable
   today regardless of the deferred AI-Act duties.
4. **Unlawful social-media/credit/criminal screening** — strong German-law prohibition; case-by-case.
5. **Self-exposure discovery + source hardening (LinkedIn/Xing settings)** — prevention that reduces
   re-scrape refill; the compounding, cheapest rung.

## 7.8 Status: all §7.7 targets addressed + engine booted (2026-08-10, ADR-026)

- **#1 enrichment brokers** — done (ADR-024): 6 playbooks + stencil, `SelfServeRoute` seed.
- **#2 applicant retention** — done (ADR-025): `assessApplicantRetention`.
- **#3 AI screeners** — `templates/art15h-22-3.de` (Art. 15(1)(h) + Art. 22(3)) + `explanation.hirevue`,
  `explanation.retorio` (`active:false`). GDPR levers usable now; AI-Act duties deferred to Dec 2027.
- **#4 unlawful screening** — `templates/art15-17-screening.de` (access + Art. 17(1)(d) erasure of
  data beyond the German employment-law limits) + `loeschung.hireright` (`active:false`).
- **#5 source hardening (SAFE part)** — LinkedIn/Xing privacy-hardening `SelfServeRoute`s (login-gated
  guided handoffs, `SOURCE_HARDENING_ROUTES`). The dual-use self-exposure **scanner** (§7.5) is
  deliberately NOT built — gated behind OQ-18 (anti-stalker one rule).
- **Engine booted** — the create wiring runs end to end via an in-memory adapter
  (`InMemoryRequestsRepository`): `engine-e2e` test + a runnable `tools/demo/run-engine.mjs` demonstrate
  self-serve routing, legal creation, idempotency blocking, NO_ROUTE for the counsel-gated flagship, and
  the retention engine. A NestJS boot (`apps/api/src/app.module.ts`, `apps/api/src/main.ts`,
  `apps/api/src/requests/requests.module.ts`) is the
  production HTTP path (typechecks; runs once `@nestjs/*` is installed and a Prisma/Postgres adapter
  replaces the dev in-memory repo — pnpm/corepack is broken and the schema is Postgres-only in this
  sandbox, so the in-memory engine is the runnable proof). Core suite: 163 tests.
