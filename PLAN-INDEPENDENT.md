# PLAN-INDEPENDENT — Scraper with zero vendors, minimal paperwork, Germany-first, globally portable

**Date:** 2026-08-26 · **Derived from:** a 12-agent research/design/verify pass (5 repo readers, 5
designers with live web research dated 2026-08-26, adversarial safety + practicality reviews; the
evidence-honesty pass was re-run by hand against the §6 three-place rule, the legal-accuracy second
pass did NOT run — every load-bearing legal claim below is designer-verified-with-citation, not
independently re-checked). **Authority:** this file plans; it overrides nothing. `CLAUDE.md` outranks
everything here. Companion: `PLAN-OPERATIONAL.md` (the operated-node sequencing this file re-scopes
for full independence).

## 1. What "independent" means — and what it never means

**Independent** = a private individual on a posture-A node (docs/14) can run the full loop with
**zero B2B contracts, zero entity, zero negotiated procurement, and near-zero paid counsel**, and the
same architecture later serves any self-hoster in any jurisdiction. The method is always the same:
**route around procurement and self-imposed evidentiary bars with honest labeling — never around the
law, and never by weakening a guarantee.**

Three findings make this possible, all already latent in the repo:

1. **Self-representation dissolves the agency paperwork.** On posture A the sender IS the subject
   (docs/14 §2): no Vollmacht, no RDG engagement, no QES-mandate procurement, arguably no GDPR
   applicability at all (Art. 2(2)(c) household exemption — Recital 18's own examples are
   "correspondence and the holding of addresses", which is literally what the node does; OQ-28 stays
   open but both branches are cheap, see §7).
2. **The escalation surface mostly doesn't need the clock.** Escalating on a refusal or an
   incomplete answer needs no provable send — the reply proves receipt (invariant 4b). The
   enforcement data (docs/13: ~83.5 % of answers inadequate per noyb) says answered-but-inadequate
   dwarfs silence. The expensive provable-send machinery is the insurance policy for the silent
   minority, not the main path.
3. **The regulated artifacts have consumer-shaped substitutes in 2026** — a €3.30 counter
   transaction replaces the postal API; a ~€10–15/100 retail pack (unverified, §4) or a free
   government TSA endpoint (unverified, §4) may replace the QTSP contract; a €1.40–1.75 consumer QES
   (D-Trust sign-me, individually procurable today, free via the EUDI wallet ~Jan 2027) replaces the
   ident vendor's strongest artifact.

**What stays absolutely fixed, on every posture, in every jurisdiction:** the anti-stalking identity
gate and closed `SUBJECT_FIELDS`; no third-party subjects, no bulk, no lookup capability, no
aggregation; the two-clock honesty (`deadlineAt` only from a provable send with a qualified anchor —
the three-place §6 rule is amended only additively, never relaxed); no false data ever; no credential
storage, no automated logins, no CAPTCHA interaction, no scraping; parser output never triggers
irreversible actions; human-gated escalation; EU residency for German nodes.

## 2. The blockers and their answers (summary)

| Blocker | Today | Independent answer | Cost to a posture-A user |
|---|---|---|---|
| D1 identity vendor (B2B, entity-gated) | No production path to `VERIFIED` at all | Assurance ladder: `SELF_ATTESTED` (curated-allow-list unlocks only) → `QES_NAME_BOUND` (sign-me + self-hosted DSS verification) → vendor eID (posture B/C) — §3 | €0 / ~€1.50 per QES |
| D6 QTSP contract | `simulated` posture: no clock ever | Evidence-grade ladder QUALIFIED \| CORROBORATED \| SIMULATED; retail qualified packs + free-qualified-endpoint verification; clock stays QUALIFIED-only — §4 | €0–€15 one-off (unverified) |
| Postal API vendor | `letterxpress` throws without credentials | `SCRAPER_POSTAL=manual`: print → Einwurf-Einschreiben at the branch → user records Beleg via the existing manual proof route — §5 | €3.30/registered letter |
| Mail identity (hidden blocker) | `dkimAligned:false` hard-fails every email send | Own domain + DKIM-relaying mailbox, guided setup; or the documented **no-email posture** (webform + manual postal only) — §6 | ~€20–50/yr or €0 |
| Counsel latency + entity + DPIA | Weeks–months, cash, gates everything | `COMMUNITY_REVIEWED` sign-off tier bound to the Datenanfragen.de CC0 corpus (posture-A-only unlock); licence package; household-exemption dual-reading record; one small 3-question counsel instruction at public release, not before first send — §7 | ~€0 until public release |
| Germany-only architecture | Clock/venue/renderer hardcoded DE | Jurisdiction packs (counsel-signed corpus artifacts); only additive schema fields cut now — §8 | — |

## 3. Identity without a vendor — the assurance ladder (D1)

**Web-verified facts (2026-08-26):** direct eID consumption is terminally closed to individuals
(§21 PAuswG Berechtigungszertifikat requires *organisationsbezogene Nutzung*; the docs/15 D1 row's
"eID is the only route an individual can procure" is wrong in both directions and must be corrected).
EUDI-wallet PID presentation to a private relying party is blocked by CIR (EU) 2025/848
(organisation-shaped RP registration, applies 2026-12-24) — monitor, don't build. But **consumer QES
exists today**: D-Trust **sign-me** serves private individuals with no business contract, free
eID-based registration, ≈€1.40–1.75/signature; the node validates signatures itself with the EU's
open-source **DSS library** against the EU trusted lists (a `services/qes-verify` sidecar, treated
like the doc sandbox). eIDAS 2.0 Art. 5a makes wallet QES **free for non-professional use** from the
German wallet launch (target 2027-01-02, slippage likely) — same verifier, cost drops to zero.

**The ladder** (all behind the unchanged `IdentityProvider` interface; `deriveSubject()` stays the
only subject constructor):

- **`SELF_ATTESTED`** (€0, ships first): a production-mountable ceremony — step-up auth, the user
  enters legal name/DOB/address once into the sealed identity record, signs a plain-B1 declaration,
  everything evidence-chained. The Mandate is the D7 in-app confirmation + hash.
- **`QES_NAME_BOUND`** (~€1.50 today, €0 ~2027): the user QES-signs a node-generated attestation;
  DSS validates against the LOTL and matches the certificate's subject name to the attested
  `legalName`. Also makes `signMandate` real, and lets outbound letters be QES-signed — stronger
  requester credibility than an ID copy while shipping *less* personal data (the noyb/Whitebridge
  norm: controllers may not demand over-proof under Art. 12(6)).
- **`VENDOR_EID`** (posture B/C, entity-gated): unchanged, contract-gated, off the critical path.

**Safety corrections (adversarial review — these are load-bearing, the naive design was wrong):**

1. **`SELF_ATTESTED` unlocks a curated per-playbook allow-list, never the `identityProof:false`
   flag.** The flag means "no ID copy travels", not "safe on a self-attested identity". Wave-1
   allow-list = `werbewiderspruch.az-direct` + objection-class only, each reviewed once for
   third-party-actionability. New playbooks default to locked.
2. **Access-class instruments NEVER run below a third-party-anchored tier.** `minAssurance` is a
   *required* playbook field, and spec-audit refuses any access/portability/right-to-know request
   type whose floor is below `QES_NAME_BOUND` **and** whose response-routing channel is not verified
   beyond self-attestation. This is a pack-invariant (§8), enforced in schema + `runGuards()`, not in
   author discipline. The chain "type a victim's name → CCPA access request → controller returns
   their data" must be structurally impossible.
3. **Bureau playbooks (`provenance.*`, `datenkopie.schufa`) never unlock on self-attested
   DOB/address, regardless of what a bureau would accept** — QES binds a *name* only; the homonym
   attack (genuine certificate in a shared name + victim's DOB/address typed into the attestation)
   defeats bureau matching, and the bureau file is the exact stalker bounty CLAUDE.md names. The
   node's bar must exceed the controller's here, because the controller's verification is the layer
   being substituted away. OQ-35 goes to counsel *with the homonym attack stated*, and its answer
   cannot lower this floor.
4. **BYO-Datenkopie ingest requires ≥ `QES_NAME_BOUND`.** At `SELF_ATTESTED` the identity-match
   purge check is circular (attacker-typed values vs attacker-supplied document) — a null control.
5. **Single-account enforcement is continuous, not boot-time:** a DB constraint pair (no second user
   row while a `SELF_ATTESTED` identity exists; no `SELF_ATTESTED` identity while >1 user row
   exists), checked at account- and identity-creation, readiness-surfaced, boot check as backstop.
   "Operator account" is not software-checkable; "the node's sole account" is. `SCRAPER_IDENTITY=
   self-attested` + declared posture B = boot refusal (one posture declaration, not two).
6. **The postal loopback verifies nothing** (the user prints the code themselves) — it is retained
   only as a typo-catcher and labeled `ADDRESS_CONTROL` at best, never "verified". High-sensitivity
   release paths must gate on an address-verification tier self-attestation structurally cannot
   reach, and invariant 3 ("bounty routes to the claimed address") must be documented as covering
   the postal channel only — email-first routing (§5) sits outside it.
7. **Honest labeling everywhere:** this *is* the change docs/14 §8 currently forbids ("no weakening
   of the identity gate to make self-hosting cheaper"), so it lands only as an explicit owner+safety
   decision (D11) amending docs/14 §4/§8, `subject.ts` docstrings, and every surface that says
   "provider-verified" — the honest sentence is "the gate's *mechanics* are unchanged; its
   *guarantee* is narrowed on posture A to what a single-person node can honestly carry". UI renders
   "Selbst bestätigt", never "verifiziert". Rate caps and anomaly logging apply unconditionally.
8. **Posture-B floor (OQ-31/33):** all three subject fields third-party-anchored (name via QES/eID
   AND address AND DOB from anchored sources) or stay at `VENDOR_EID` — QES-name-only was considered
   and is insufficient for non-operator users.

**Tier-2 prerequisites stated honestly:** sign-me needs an activated Online-Ausweisfunktion, a known
eID PIN, and an NFC smartphone; the PIN-reset letter adds days. Degradation path: stay on
`SELF_ATTESTED` with its restricted allow-list.

## 4. Evidence and the clock without a QTSP contract (D6)

**Legal ground (eIDAS Art. 41, verified):** a non-qualified timestamp is *admissible* (Art. 41(1),
§ 286 ZPO freie Beweiswürdigung); what qualified adds is the Art. 41(2) *presumption*. And even a
qualified anchor never proves delivery — the carrier's Auslieferungsbeleg is the substantive proof;
the anchor fixes when our copy existed. The qualified-or-no-clock bar is self-imposed conservatism
(ADR-012) and **stays**; independence comes from making the qualified rung cheap and the middle rung
honest.

**The evidence-grade ladder** (additive; the clock rule is untouched):

| Grade | What it is | May mint `deadlineAt` |
|---|---|---|
| `QUALIFIED` | eIDAS Art. 42 token, trusted-list-verified (today's `QualifiedTimestamp`) | **Yes — only this** |
| `CORROBORATED` (new) | Same sha256 at ≥2 independent free RFC 3161 TSAs (10-min tolerance) + OpenTimestamps Bitcoin anchor (async upgrade) | Never — powers provisional scheduling + honestly-labeled DPA exhibits ("nicht qualifizierter Zeitstempel — freie Beweiswürdigung") |
| `SIMULATED` | Local clock (unchanged) | Never |

Mechanics: a third variant of the `TimestampAnchor` union; `isQualifiedAnchor()` unchanged so every
existing consumer keeps refusing the new grade with zero edits; no new constructor —
`ProvableSendEvidenceId` keeps one minter. New `MultiTsaTimestamper` (`SCRAPER_TIMESTAMPER=
multi-tsa`) with a seeded, **ToS-checked** endpoint registry (staleness discipline like
`SelfServeRoute`); below quorum it degrades to `SIMULATED` honestly. Privacy: batch-scheduled
chain-head anchoring is the **enforced posture-A default** (per-event anchors leak per-send timing to
TSA operators and public OTS calendars — on posture A that is one identifiable person's
rights-exercise trace); per-event only on explicit opt-in for clock-critical sends, EU voices
preferred. **The default flip from `simulated` to `multi-tsa` is gated on completing the per-endpoint
ToS pass** — until then multi-tsa ships opt-in.

**The qualified rung for an individual, cheapest first — all UNVERIFIED until a real purchase test:**

1. **Free public endpoints operated by trusted-list QTSPs** (tsa.belgium.be/connect,
   timestamp.aped.gov.gr/qtss, tss.accv.es:8318/tsa, tsa.baltstamp.lt, timestamp.sectigo.com/qualified,
   ts.quovadisglobal.com/eu). "Operated by a QTSP" ≠ "this token is qualified": per host, fetch a
   live token → extract the TSU cert → confirm `QTST`/`granted` on the national trusted list (ETSI
   TS 119 615; DSS automates it) → read the ToS → file an ADR. **One verified host makes the
   qualified grade free and dissolves D6 — highest payoff-per-hour task in this plan (OQ-37).**
2. **Retail packs**: Openapi/InfoCert 100 stamps €9.70+VAT (the repo's `OpenapiTimestamper` already
   targets exactly this product — zero new code if signup accepts individuals); Disig TS-100
   €14.35 incl. VAT; Aruba €13.50+VAT/50. A pack ≈ 2–5 years of statutory clocks (~2 anchors per
   registered letter, 5–20 letters/yr). **Run the €10–15 one-afternoon purchase test as a German
   natural person before any doc claims D6 closed (OQ-40)** — a VAT-number wall at all three would
   mean the clock stays entity-gated and posture A stays degraded-but-honest, which the repo already
   supports.
3. **From ~2027:** wallet QES over the receipt bundle on the manual delivery-proof seam — if the
   embedded PAdES-T signature-timestamp is qualified, one free human act yields a qualified anchor
   *and* binds the attester's identity, curing the existing `TODO(safety)` in `ops.service.ts`
   (OQ-39).

**Three-place rule change (counsel-gated, all three docs in one commit):** the `deadlineAt` sentence
stays byte-identical; an additive grade-vocabulary bullet lands in `CLAUDE.md` §6, `docs/05` §6, and
invariant 7 of `schema/request-state-machine.md` ("clock-critical records are anchored at the best
grade available; only QUALIFIED authorises `provableSendConfirmed`; grades are never upgraded after
the fact; no grade below QUALIFIED is ever presented as qualified anywhere"). Design 5's larger grade
taxonomy is a documented future superset (its `CARRIER_CERTIFIED`/`DESIGNATED_CHANNEL_RECEIPT` are
DeliveryProof/channel concepts, not anchor kinds) — **it may not touch the union until this lands.**

## 5. Provable send without a postal vendor — `SCRAPER_POSTAL=manual` + email-first

**The Filial-Loop** (default postal posture; the D6 doctrine applied to the postal seam, which today
can only boot into per-letter failure):

1. **Print pack:** the node renders the DIN 5008 PDF (subject fields still derived only via
   `deriveSubject()` — printing at home opens no free-text anywhere) + a B1 pictogram checklist.
2. **Lodgement:** user posts Einwurf-Einschreiben at a branch (**€3.30**, 2026 tariff), enters the
   Sendungsnummer (validator **warns-and-accepts** non-S10 formats until the owner's first-hand
   Beleg-flow walk-through confirms real formats), photographs the Einlieferungsbeleg (new
   non-clock-eligible evidence kind `LODGEMENT_RECEIPT`). → `AWAITING_DELIVERY_PROOF`, **no clock**.
   This is the first user-actor path into SENT, so it gets an explicit design: a dedicated
   `manualDispatchConfirmed` event, actor `USER`, carrying the letter-PDF hash, through the existing
   guard set, idempotent on Sendungsnummer — not a casual reuse of the worker's dispatch path.
3. **Wait:** reminders keyed to § 18 PostG (E+4, E+7); `proofDueAt` renotifies before `NEEDS_HUMAN`
   (a missing *look* is not a missing *receipt*; the Beleg stays retrievable 15 months). Optional
   status *hint* via the self-service DHL Unified Tracking API — display/notification only, **never a
   transition** (BAG 2 AZR 68/24: status ≠ proof; and the developer-portal terms for natural persons
   are unverified, OQ-43 — losing the feature costs zero correctness).
4. **Proof:** the user opens Deutsche Post's own tracking page in their own browser, answers the
   page's inputs themselves (a human doing a human check — **no scraping, no CAPTCHA interaction,
   categorically**), downloads the Auslieferungsbeleg PDF, and records it through the **existing**
   `recordDeliveryProof` route: anchor, mint (fail-closed without a qualified anchor), month runs
   from the Beleg's documented date. Automation, if it ever comes, replaces the actor, not the rule.

**Email/webform-first is the channel strategy, not a fallback.** Everything except
silence-escalation is clock-free: COMPLIED closes; REFUSED/INCOMPLETE escalate on the reply itself;
Tier 0/1 routes aren't RightsRequests at all. Silence → the user authorises the €3.30 registered
re-send (fresh month from delivery) or declines (`NO_PROVABLE_CLOCK`, honestly excluded from stats).
Worst case per controller: €3.30 + ~€0.10 anchor; a heavy user ≈ €13–17/yr. **Proposed and
counsel-gated (OQ-41):** flip the 7 bureau playbooks to the az-direct shape (email/webform-primary,
registered-fallback-on-silence) — bureaus overwhelmingly answer, any answer unlocks the whole
provenance downstream with no clock ever, and the flagship module's entry cost drops to €0.

**Webforms** become a guided-handoff surface with the same user-executed-channel pattern (prepare →
user acts in own browser → returns with screenshot/confirmation → node records with
`USER_ATTESTED` origin, provisional clock only, structurally). URL provenance: only counsel-verified
playbook/`SelfServeRoute` URLs, never a URL from a parsed reply without human review.

**Honest effort statement:** "runnable end-to-end" today means manual response ingestion — no
inbound mail implementation, the doc sandbox ships refusing, every reply is hand-uploaded and
hand-classified. That is acceptable for the owner's node and must be stated (and budgeted ~15–30
min/request) in any public-release claim.

## 6. The mail channel — the dependency nobody priced

The shipped email channel hard-fails any send that is not DKIM-aligned (`channels/email.ts`), and
alignment requires the node to hold the DKIM private key for the From domain — **a consumer mailbox
(gmail/gmx/web.de) can structurally never satisfy this.** The real posture-A email stack is: a
registered domain (~€5–15/yr) + a mailbox/relay that carries the node-signed mail intact
(~€12–36/yr) + keypair/DNS setup. Consequences:

- The operator runbook gets a guided DKIM setup + preflight using the existing
  `SmtpMailer.alignment()` probe, with cost and time stated.
- A documented **no-email posture** exists (owner decision): webform guided-handoff + manual postal
  only, so a user without a domain still has a lawful first action.
- Every "€0 / zero-dependency first send" claim is corrected to "€0 *given* a mail identity, or via
  the no-email posture"; the combined critical path (§9) carries it as an explicit item.

## 7. Paperwork-minimal path — community review, licence, household exemption

- **`COMMUNITY_REVIEWED` sign-off tier** (owner decision D10; amends the counsel-only gate stated in
  five normative places — one commit, all of them): binds a hash-sealed template to the
  **Datenanfragen.de CC0 corpus** (actively maintained, pushed 2026-08-13; German
  objection/erasure/access/admonition/Art-77 templates in public use since 2018; its
  `objection-default.txt` is a near-twin of our `art21-werbewiderspruch.de.md`) via pinned provenance
  + recorded diff — vendored snapshot at a commit SHA, never a live fetch (no-phone-home).
  Unlocks activation/dispatch **only on a declared posture-A node** after a typed informed-consent
  acknowledgment ("…als meine eigene Erklärung — keine Rechtsberatung") recorded against the
  version — which is exactly the OQ-30 disclaimer deliverable, drafted now, counsel-confirmed at
  public release. Posture B/C: `COMMUNITY_REVIEWED` behaves like `DRAFT` at all four enforcement
  points. UI copy: "Vorlage aus dem Gemeinschaftsfundus (CC0) — keine anwaltliche Prüfung", never
  "geprüft"; forbidden-phrase test added. Wave 1: art21-werbewiderspruch, art17-loeschung,
  art17-datenhaendler, art15-datenkopie, + newly vendored `mahnung.de.md` and
  `art77-beschwerde.de.md` (closing the "ESCALATION_DRAFTED has no prose" gap for a
  self-representing complainant — DPAs accept free-form complaints from individuals). The four novel
  instruments (art15g-herkunft, loeschung-herkunft, art15h-22-3, art15-17-screening) **stay DRAFT
  pending counsel on every posture** — substantive risk, not paperwork.
- **Licence package (pure engineering, ~1 day, unblocks D3):** root `LICENSE` AGPL-3.0-only;
  `templates/`+`playbooks/` CC0-1.0 (round-trips with upstream; the census attribution is a
  self-imposed courtesy, stated accurately); `THIRD-PARTY-NOTICES.md` (pnpm licences + Datenanfragen
  + JustDeleteMe MIT); `SECURITY.md` with a real disclosure contact. No LICENSE = the whole
  self-host launch is unlawful to distribute — this is the one genuinely statutory release blocker.
- **Household-exemption dual-reading operator record (OQ-28 made non-blocking):** one page shipped
  in the operator guide: (i) "you are likely exempt — Art. 2(2)(c)/Recital 18 'correspondence and
  the holding of addresses'; the CJEU narrowing cases (Lindqvist, Ryneš, Buivids) all turn on
  leaving the private sphere, which posture A never does"; (ii) "if not exempt, this page is your
  ROPA/DPIA-lite: controller = you, subject = you, basis = your own instruction, recipients = the
  controllers you write to + your chosen SMTP/QTSP, retention = D8". Residual duties survive either
  way: docs/14 §5 doctrine + Art. 5(1)(d) accuracy + ordinary care.
- **Ruthless OQ triage:** venue questions dissolve (Art. 77(1) gives the complainant habitual
  residence unconditionally); endpoint currency is reclassified counsel → operator two-source
  fact-check (live Datenschutzerklärung + Datenanfragen record, dated in the census row) — applies
  to recipient addresses only, never instrument choice or template substance; OQ-11 blocks only
  asserting an *earlier* clock than the implemented conservative reading. **Digital Omnibus
  (verified): the GDPR strand has no Council or Parliament position as of Aug 2026 — nothing changes
  Art. 15/12, no send waits on it; its purpose-limitation direction actually strengthens the
  posture-A story.**
- **The counsel bill:** first send = **zero paid items** (two owner decisions + one fact-check +
  identity build). Public release = **one small instruction**: OQ-28 residual duties, OQ-29
  posture-B boundary sentence, OQ-30/32 disclaimer + COMMUNITY_REVIEWED framing, + an hour on the
  licence. Entity (D2) stays deferred — publishing FOSS as a natural person is ordinary
  (Impressum/§5 DDG exposure for a private repo: flagged, not asserted).

## 8. Global application — jurisdiction packs

The engine is closer to neutral than it looks: the state machine's shape, identity binding, evidence
chain, and the leverage ladder are jurisdiction-free; the DE-specific matter concentrates in five
seams (clock arithmetic in `statutory-clock.ts`, the clock-start evidence standard, the `seatDpa`
venue enum, DIN 5008/Einwurf semantics, templates/copy).

**Packs are counsel-signed corpus artifacts** (`packs/<code>/` with `pack.yaml`, a normative
`clock-rule.md`, templates, census overlay, venues, holidays) reusing every existing integrity
mechanism: hash-bound sign-off, shipped-inactive activation, per-pack spec-sync. The three-place rule
is promoted to a **meta-rule** ("every pack's clock rule is normative, counsel-signed, hash-bound;
the DE instance is byte-identical to today's text — never relaxed") via one owner+counsel ADR
(OQ-45). Two clock species: DELIVERY-anchored assertion (DE doctrine, unchanged) and
RECEIPT/SUBMISSION-anchored (CCPA-class: the statute keys on receipt via the controller's designated
method — a webform capture/DKIM accept is the natural evidence; Quebec/PIPEDA's deemed-refusal maps
silence onto the existing REFUSED path, *cleaner* than GDPR). Each pack ships exactly one
clock-evidence constructor (the `provableSendEvidenceIdOf` pattern), fail-closed, no second minter.

**Verified clock table (2026-08-26):** GDPR 1 month +2; UK 1 month +2 with **DUAA stop-the-clock**
(Part 5 commenced 2026-02-05, ICO guidance 2026-04-07) — a genuinely new `pausedAt/resumedAt`
context; CCPA 45+45 days from receipt, access 2×/12 months (a statutory `coolingBound` for
`mayOpenNewCycle()`); **California DROP: consumer submissions since 2026-01-01, broker processing
mandatory since 2026-08-01, ~600 registered brokers — a state-run Tier 0 covering the US broker
problem in one guided submission**; LGPD 15 days (ANPD rights regulation status unconfirmed — hold);
Quebec Law 25 30 days, silence = deemed refusal; PIPEDA 30+30 (C-27 dead); Australia APP 12 ≤30 days
(OAIC); India DPDP rights effective only 2027-05-13 (PREVIEW pack only); Switzerland 30 days; Japan
"without delay" + 内容証明郵便 as a *superior* provable-send analog, but **Attorney Act Art. 72:
subject-acting-only, hosted-for-fee prohibited — encoded as `legalModel` flags the readiness gate
enforces**. US provable-send analog: USPS Certified Mail + Electronic Return Receipt (~$5,
self-serve, 10-year PDF). **The architectural headline: self-hosted posture-A software is the
subject acting for themselves — it sidesteps CCPA authorized-agent registration, RDG, and 非弁
identically.** EU-wide independence lever worth its own counsel question: **QERDS/qualified LRE
(eIDAS Art. 43)** collapses postal+QTSP into one consumer-purchasable service (AR24-class, a few €
per send, no consent needed for professional recipients) — pending per-state verification and never
assumed to satisfy the DE Einwurf doctrine without a three-place change.

**Sequencing: AT first** (same law + language — the cheapest full test of the pack pipeline, prices
the other 25 member states), **then UK** (fresh DUAA deltas exercise the clock parameterization for
real; English corpus unlocks the anglophone world), **then US-CA + a us-generic overlay** (20 state
laws, modal 45+45 shape; DROP as Tier 0; largest counsel delta). **China and Russia are REFUSED
registry entries with published rationale** — a self-hosted rights tool must not endanger its own
user; a fork removing the refusal is a visible act.

**Never parameterized (pack-invariant, now including the verifier's additions):** identity binding +
closed subject fields (widening `SUBJECT_FIELDS` is a safety design change requiring its own review;
any new identifier — e.g. the account email a US pack needs — derives from a verified artifact of
the account, never ceremony free text); **access-class instruments never run on `SELF_ATTESTED`**;
no third-party subjects/bulk/lookup/aggregation; two-clock labeling; simulated evidence minting
nothing anywhere; human-gated escalation; no false data; per-request purpose recording. Open
owner+counsel question (OQ-44): whether EU-only residency generalizes to "subject-controlled,
operator-local" for non-EU packs.

**Re-sequenced against merge risk:** only the contention-free additive items land now
(`jurisdiction`/`regime` schema fields defaulting DE/GDPR; the REFUSED-registry doctrine). Clock
extraction, venue generalization, and all evidence-grade taxonomy work wait until the first-send
wave and §4's union change are merged — refactoring the two things the repo says must never be
wrong in the same window as the first real send is the wrong trade.

## 9. The combined first-send critical path (no design's headline stands alone)

| # | Item | Kind | Est. |
|---|---|---|---|
| 1 | Licence/notices/SECURITY package | code | 1 d |
| 2 | Signoff vocabulary (`COMMUNITY_REVIEWED`) + posture declaration + acknowledgment flow, staged behind D10 | code | 2–3 d |
| 3 | Corpus provenance pass (pin datenanfragen SHA, diff wave-1, vendor mahnung + art77) + OQ-28 dual-reading page | code/docs | 2 d |
| 4 | OQ renumber block landed in counsel-packet allocation table (one commit, oq-check green) | docs | ½ d |
| 5 | D10 + D11 + D12 + D13 owner decisions; posture A declared (docs/14 §1); D4 pricing supersession | owner | one sitting |
| 6 | `SELF_ATTESTED` ceremony with §3's constraints (allow-list, DB constraint pair, labeling edits) | code | 3–5 d |
| 7 | Mail identity: domain + DKIM-relaying mailbox + guided preflight — **or** documented no-email posture | owner + code | ½ d + ~€20–50/yr |
| 8 | az-direct endpoint two-source fact-check; template marked COMMUNITY_REVIEWED; `corpus:activate` with acknowledgment | owner | hours |
| 9 | **First send** (email, provisional clock) → `AWAITING_RESPONSE_PROVISIONAL` | — | — |
| 10 | Within ~30 d: `SCRAPER_POSTAL=manual` + Filial-Loop endpoints (the silence fallback) | code | 1–2 wk |
| 11 | Parallel experiments: OQ-37 free-qualified-endpoint check; OQ-40 retail purchase test; multi-TSA ToS pass | eng/ops | afternoons |
| 12 | QES tier + DSS sidecar (unlocks BYO ingest, stronger label) | code | 1–2 wk |

Public release additionally requires: packaging (compose bundle incl. Postgres + the Java DSS
sidecar + guided env setup + readiness screen — **currently unbuilt and unscheduled; every "any
citizen" claim is false until it lands**), the operator guide, the usability gate on web-next, and
the one small counsel instruction. Audience claims are split everywhere: *owner/developer, now* vs
*general public, after packaging*.

## 10. Decisions to mint (docs/15 §2) and the OQ block

**Decisions (owner):** **D10** COMMUNITY_REVIEWED dispatch on declared posture A (amends the
counsel-only gate — all five normative statements in one commit) · **D11** `SELF_ATTESTED` as a
production posture under §3's constraints (amends docs/14 §8's "no weakening" sentence — owner +
safety, explicitly recorded as a narrowed-guarantee decision) · **D12** multi-tsa default flip gated
on the ToS pass · **D13** `SCRAPER_POSTAL=manual` as a shipped posture + no-email posture exists ·
**D14** jurisdiction-pack commitment + REFUSED registry.

**OQ allocation (the four designs each independently claimed "32" — this table renumbers before
anything lands; land it in `docs/counsel-review-packet.md` §2 in one commit):**

| OQ | Question | Owner |
|---|---|---|
| 32 | COMMUNITY_REVIEWED framing + activation-disclaimer wording (D10 confirmation) | counsel |
| 33 | SELF_ATTESTED gate semantics (sole-account constraint, allow-list, labeling) + posture-B three-field floor | safety + counsel |
| 34 | Assurance modeling: `assuranceLevel` on VERIFIED vs new status (ADR; touches ADR-009/019 surfaces) | eng + safety |
| 35 | QES-signed letter vs bureau requester verification — **framed with the homonym attack; cannot lower the §3.3 floor** | counsel |
| 36 | Corroborated-exhibit disclaimer wording for Art. 77 drafts | counsel |
| 37 | Per-host verification of free public qualified-TSA endpoints (token → TSU cert → trusted list → ToS → ADR) | eng |
| 38 | Host allow-list vs token-level trusted-list validation (DSS sidecar) as the basis for asserting QUALIFIED | safety + eng |
| 39 | QES-over-receipt on the manual proof seam (is the embedded PAdES-T token qualified? sign-me now, wallet 2027) | counsel + eng |
| 40 | Retail qualified-pack natural-person purchase test (Openapi VAT wall? Disig? Aruba codice fiscale? StampR backing?) | ops |
| 41 | Bureau playbook channel flip to email/webform-first (Art. 12(5) prejudice? ID packet by email vs portal?) | counsel |
| 42 | User-retrieved Auslieferungsbeleg + re-keyed date sufficiency before a DPA (extends ops.service TODO) | counsel |
| 43 | DHL Unified Tracking API natural-person terms (drop the hint job if hostile — zero correctness loss) | product |
| 44 | EU-residency rule generalization for non-EU posture-A packs (CLAUDE.md edit — owner-level) | owner + counsel |
| 45 | Three-place meta-rule promotion for jurisdiction packs (DE instance byte-identical) | owner + counsel |

## 11. Risks and unverified items, stated plainly

- **The retail QTSP path may fail for natural persons** (OQ-40 unrun). Fallback exists and is
  honest: degraded-but-honest posture, refusal/incomplete escalation only — the repo already
  supports it, and the majority of the enforcement surface doesn't need the clock.
- **The free-qualified-endpoint hypothesis is unverified** (OQ-37) — but it is an afternoon of work
  with the highest payoff in this plan.
- **The legal-accuracy second pass did not run.** Every statute/date above carries a designer
  citation dated 2026-08-26, but the plan treats none of them as counsel-grade; the one small
  counsel instruction at public release is where they get confirmed.
- **Packaging is the real public-release long pole** now that counsel isn't — it is named,
  scheduled, and gates every population-level claim.
- **sign-me AGB / coin expiry / eID-activation rate** in the target population: folded into OQ-33/35
  scoping; degradation path documented.
- **D11 is a genuine narrowing** of what the identity gate guarantees on posture A. The plan's
  position: on a single-person node the operator was always outside the software trust boundary
  (docs/14 §4 already concedes psql suffices), so the honest change is in the *label*, not the
  *threat model* — but it must be decided as such, never slipped in.

## 12. What no session may build (restated, with this plan's additions)

Everything in `PLAN-OPERATIONAL.md` §7, plus: no access-class instrument below a third-party-anchored
tier; no widening of `SUBJECT_FIELDS` without a safety design; no `SELF_ATTESTED` unlock outside the
curated allow-list; no TSA endpoint into any qualified list without the per-host ADR evidence; no
DHL-status-driven transitions; no scraping of deutschepost.de and no CAPTCHA interaction anywhere;
no live corpus fetches (vendored snapshots only); no pack for China or Russia.
