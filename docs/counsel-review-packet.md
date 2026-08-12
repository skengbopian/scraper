# Counsel review packet — everything that blocks a real send

**Snapshot:** repo state at commit `d0941af`, compiled 2026-08-12. File/line references are to this
snapshot; re-run `grep -rn "TODO(counsel)"` after any edit.

This packet is the single organised handoff for German data-protection **and RDG** counsel. It compiles —
without resolving — every open legal question, draft template, unverified endpoint, and counsel-gated
activation decision currently recorded in the repo, so that counsel can clear, item by item, everything
that stands between the built engine and the first real outbound request. It is a compilation with
citations, not a legal analysis: nothing in it takes a position, and **nothing it lists is enabled until
signed** — every playbook ships `active: false` (verified against `playbooks/.shipped.json`), all seven
templates are marked DRAFT in their own headers, and flipping any playbook to `active: true` is a
deliberate human act recorded against that playbook's `version` (`ARCHITECTURE-DECISIONS.md` §4,
`docs/04-playbook-spec.md`). How to use it: work through §§1–5 in order, mark each row's sign-off box with
date and notes; §6 names the governing legal frame; §7 orders the shortest route to the first real send.
Per `docs/04`, a signed artefact is never mutated — a change after sign-off bumps the `version` and
re-enters review.

Sections:

1. [`TODO(counsel)` inventory](#1-todocounsel-inventory) — every marker in the repo, by file:line.
2. [Open questions OQ-7 … OQ-22](#2-open-questions-oq-7--oq-22) — the decisions no coding agent may take.
3. [Template sign-off matrix](#3-template-sign-off-matrix) — 7 templates, their playbook bindings, statutory basis.
4. [Playbook activation checklist](#4-playbook-activation-checklist) — 15 playbooks, per-slug verification before `active: true`.
5. [CoC rules-engine sign-off](#5-coc-rules-engine-sign-off-s1s7--p15) — S1–S7 levers, rule-set versioning, § 37a BDSG re-audit.
6. [Governing frame](#6-governing-frame-docs05-legal-guardrailsmd) — `docs/05-legal-guardrails.md`, cited not restated.
7. [Fastest path to the first real send](#7-fastest-path-to-the-first-real-send) — ordered, from `ARCHITECTURE-DECISIONS.md` §4.

---

## 1. `TODO(counsel)` inventory

Source: `grep -rn "TODO(counsel)" --include="*.ts" --include="*.md" --include="*.yaml" .`
(node_modules/dist excluded), snapshot above. Grouped by artefact class. Playbook **endpoint** TODOs are
listed here once and folded into the per-playbook rows of §4; template TODOs are folded into §3.

### 1a. Substantive legal questions (docs, schema, code)

| File:line | Question (one line) | Sign-off | Datum | Notizen |
|---|---|---|---|---|
| `docs/03-data-model.md:51` | § 20 PAuswG constraints on copying a Personalausweis: which fields may be blacked out, copy marked as copy, serial number not a retrieval key; which controllers may demand a copy at all (→ OQ-10) | [ ] | | |
| `docs/03-data-model.md:123` | Set `minReExerciseDays` per request type — Art. 12(5) "excessive" cooling between lawful cycles (→ OQ-9) | [ ] | | |
| `docs/03-data-model.md:137` | Confirm the current Schufa Identitätsbetrug-Einmeldung route and the proof it requires | [ ] | | |
| `docs/05-legal-guardrails.md:75` | Confirm the fresh-month posture: registered re-send restarts a full Art. 12(3) month rather than setting a shortened Nachfrist citing the original email (ADR-012 records the alternative) | [ ] | | |
| `docs/07-controllers-seed.md:5` | Every census channel/address is a starting point — verify with counsel from the controller's current Datenschutz page before use | [ ] | | |
| `docs/07-controllers-seed.md:14` | The seat/DPA column: confirm each registered seat before enabling any playbook that escalates (wrong venue misroutes an Art. 77 complaint) | [ ] | | |
| `docs/07-controllers-seed.md:18` / `:33` | Table headers marking the bureau and Adresshändler seat/DPA columns as unconfirmed | [ ] | | |
| `docs/07-controllers-seed.md:70` | Enrichment-broker venue = user's habitual-residence Land-DPA (Art. 77(1)), not a fixed seat; every endpoint in that table TODO (→ OQ-20) | [ ] | | |
| `docs/09-pivot-modules.md:61` | Verify every bureau/broker address & endpoint against the live Datenschutz page before enabling | [ ] | | |
| `schema/request-state-machine.md:133` | Re-exercise cooling guard: set `minReExerciseDays` per request type (→ OQ-9) | [ ] | | |
| `docs/10-utility-roadmap.md:74` | § 37a BDSG (in force 20 Nov 2026) bans address/age/gender/name/social-network/account-flow data from scoring — schedule the criteria re-audit and template re-check for Nov 2026 (→ §5) | [ ] | | |
| `docs/10-utility-roadmap.md:112` | After BAG 2 AZR 68/24: does `provableSendConfirmed`/`deadlineAt` key on Einlieferung or on the retrieved Auslieferungsbeleg? Do not change the one-rule-in-three-places files until decided (→ OQ-11) | [ ] | | |
| `docs/10-utility-roadmap.md:126` | Vollmacht formalities (OLG Stuttgart; Hessian DPA Apr 2026): the Mandate/QES flow must render a controller-facing artefact that survives challenge | [ ] | | |
| `docs/10-utility-roadmap.md:254` | infoscore/Boniversum have no public fraud-victim process — direct-inquiry letters needed | [ ] | | |
| `docs/10-utility-roadmap.md:258` | Art. 44 ff. transfer assessment for HIBP breach-monitor queries (→ OQ-16) | [ ] | | |
| `docs/10-utility-roadmap.md:446` | Instrument set for the recruitment layer: a new `art21(1)-widerspruch.de` template is flagged as needed; confirm instrument choices (Art. 17 + 21(1), not 21(2)) | [ ] | | |

### 1b. Code-level markers

| File:line | Question (one line) | Sign-off | Datum | Notizen |
|---|---|---|---|---|
| `packages/core/src/state-machine/guards.ts:113` | `minReExerciseDays` is counsel-supplied config (OQ-9); the guard takes it as a parameter so the number never lives in code | [ ] | | |
| `packages/core/src/retention/applicant.ts:25` | `APPLICANT_RETENTION_MONTHS = 6`: confirm the exact number and whether it runs from rejection date or documented end of the selection process | [ ] | | |
| `packages/core/src/retention/applicant.ts:40` | AGG § 15(4) starts the 2-month clock at Zugang der Ablehnung — confirm the anchor (clamp to later of rejection receipt vs process end?) | [ ] | | |
| `packages/core/src/retention/applicant.ts:47` | `aggClaimPending` trigger: set on a WRITTEN § 15(4) Geltendmachung (not only a § 61b ArbGG suit); on conclusion the clock reverts, no fresh period — confirm | [ ] | | |
| `packages/core/src/retention/applicant.ts:54` | Talent-pool consent (Art. 7) is withdrawable and can go stale — bounded / periodically re-confirmed period vs open-ended storage | [ ] | | |
| `apps/worker/src/workflows/provenance.ts:136` | The `CONTRADICTS_ART14` escalation note: the controller's Art. 14 notice version must be verified before the contradiction is used as an Art. 77 trigger (→ OQ-8) | [ ] | | |

### 1c. Template markers (detail in §3)

| File:line | Question (one line) |
|---|---|
| `templates/art15-datenkopie.de.md:4` / `:12` | DRAFT sign-off; confirm the `{{#if identityProofEnclosed}}` wrapper does not change the letter's meaning when the branch is omitted |
| `templates/art15g-herkunft.de.md:4` / `:13` | DRAFT sign-off; same wrapper confirmation |
| `templates/art15h-22-3.de.md:6` / `:13` | DRAFT sign-off; addressee is whoever made the automated decision — usually the employer (controller), vendor possibly (joint) controller: confirm per case |
| `templates/art15-17-screening.de.md:7` / `:16` | DRAFT sign-off; screening firm usually an Art. 28 processor, request also lies against the employer — confirm per case which entity is controller |
| `templates/art17-datenhaendler.de.md:9` / `:31` / `:33` | DRAFT sign-off; confirm Art. 21(1)-grounds + Art.-14-led Art. 17(1)(d) framing; whether to cite CNIL/KASPR explicitly (and only for restricted-visibility records); whether an English variant is warranted for US/UK brokers |
| `templates/art17-loeschung.de.md:7` / `:15` / `:20` | DRAFT sign-off; optional variant citing a documented earlier Art. 21(2) objection date; NOT for Auskunfteien (bureaus: correction/retention, never blanket erasure) |
| `templates/art21-werbewiderspruch.de.md:4` | DRAFT sign-off |

### 1d. Playbook endpoint markers (detail in §4)

All are "verify recipient endpoint against the controller's live Datenschutz page" unless noted:

| File:line | Endpoint(s) |
|---|---|
| `playbooks/datenkopie.schufa.yaml:18–19` | SCHUFA postal address (Postfach 10 34 41, 50474 Köln); `meineschufa.de/datenkopie` web form |
| `playbooks/provenance.schufa.yaml:20–21` | Same two SCHUFA endpoints |
| `playbooks/provenance.infoscore.yaml:21–22` | infoscore postal (Rheinstraße 99, Baden-Baden); Experian Selbstauskunft web form |
| `playbooks/werbewiderspruch.az-direct.yaml:18–19` | `datenschutz@az-direct.de`; AZ Direct postal (Gütersloh) |
| `playbooks/loeschung.generic-adresshaendler.yaml:20` / `:22` | Per-controller Datenschutz address (`__PARAM__`); bound template is DRAFT — needs sign-off |
| `playbooks/loeschung.zoominfo.yaml:18–19` | `privacy@zoominfo.com`; canonical removal URL |
| `playbooks/loeschung.apollo.yaml:16–17` | `privacy@apollo.io`; removal form URL |
| `playbooks/loeschung.lusha.yaml:17–18` | `privacy@lusha.com`; removal form URL |
| `playbooks/loeschung.cognism.yaml:20–21` | `privacy@cognism.com`; saymine removal form |
| `playbooks/loeschung.peopledatalabs.yaml:16–17` | `privacy@peopledatalabs.com`; privacy portal |
| `playbooks/loeschung.rocketreach.yaml:16–17` | `privacy@rocketreach.co`; remove-profile form |
| `playbooks/loeschung.hireright.yaml:18–19` | `dataprotection@hireright.com`; DSR portal |
| `playbooks/explanation.hirevue.yaml:17` | `privacy@hirevue.com` — DSAR intake / EU representative |
| `playbooks/explanation.retorio.yaml:4` / `:18` | Pre-activation bundle: verify Retorio GmbH Impressum/Datenschutz postal address (Munich), add postal fallback with `registered.fallback: true`, set `seatDpa: BAYLDA`, switch `onDeadlineExpiry` to `DRAFT_ART77`; verify `datenschutz@retorio.com` |

### 1e. Convention / cross-reference hits (no independent action)

`CLAUDE.md:5, 112`, `PROMPT.md:45` and `docs/05-legal-guardrails.md:5` state the `TODO(counsel)`
convention itself. `AUDIT-2026-08-07.md:179` records the *absence* of a marker on the infoscore Art.-14
claim — since captured as OQ-8. `ARCHITECTURE-DECISIONS.md:114, 156, 340, 365, 376, 527, 548` cross-
reference markers already listed above (ADR-012 → docs/05 §6; ADR-016 → docs/03; ADR-025 → applicant.ts;
ADR-026 → per-case controller question; OQ-8 row; the §4 checklist item).

---

## 2. Open questions OQ-7 … OQ-22

OQ-1 … OQ-6 are **CLOSED** (resolved as spec edits, `ARCHITECTURE-DECISIONS.md` §3 / ADR-011..017) and
omitted. OQ-7..10 and OQ-17..22 are recorded in `ARCHITECTURE-DECISIONS.md` §3; OQ-11..16 are recorded in
`docs/10-utility-roadmap.md` §3.3 (flagged there to feed into ADR §3). Nothing in this table may be
resolved in code — each needs the named owner's decision.

| OQ | Question (condensed) | Owner | What it blocks | Sign-off | Datum | Notizen |
|---|---|---|---|---|---|---|
| OQ-7 | Do templates ship as complete sendable letters (sender/recipient block, place-and-date line, signature, `{{today}}` format), or does the postal renderer supply that envelope? | engineering + counsel | Rendering/dispatch of every letter (P1 resolves the mechanics via the DIN-5008 renderer either way — `docs/10` §3.2) | [ ] | | |
| OQ-8 | `provenance.infoscore` keys an Art. 77 trigger to "infoscore's own Art. 14 notice (V7, Aug 2026)" as unverified fact | **counsel** | Enabling `provenance.infoscore`; the `CONTRADICTS_ART14` escalation path (`apps/worker/src/workflows/provenance.ts:136`) | [ ] | | |
| OQ-9 | `minReExerciseDays` per request type — Art. 12(5) "excessive" cooling between two lawful cycles | **counsel** | Any second cycle (annual Art. 15 re-access, provenance follow-up) in production | [ ] | | |
| OQ-10 | `IdentityPacket` acquisition route (ident-provider document vs user upload) + redaction profile, incl. § 20 PAuswG | **safety + counsel** | Every playbook with `identityProof.required: true` (both provenance playbooks, `datenkopie.schufa`) | [ ] | | |
| OQ-11 | Provable-send definition after BAG 2 AZR 68/24: `deadlineAt` keyed on Einlieferung or retrieved Auslieferungsbeleg? | counsel + product | The statutory-clock trigger — touches the one-rule-in-three-places (`CLAUDE.md` §6, `docs/05` §6, `schema/request-state-machine.md`); every silence-escalation | [ ] | | |
| OQ-12 | Workflow runner M0/M1: pg-boss vs BullMQ; Temporal timing | engineering | Deadline timers firing outside the demo surface (not a counsel item; listed for completeness) | [ ] | | |
| OQ-13 | CoC rules-engine sign-off process: who approves a rule-set version; who owns the § 37a (20 Nov 2026) re-audit | **counsel** | Presenting P1.5 file-health findings as more than preliminary (→ §5) | [ ] | | |
| OQ-14 | RDG boundary for S2/S6 disputes and Art. 82 assertions in letters: Botendienst framing vs Inkasso / partner-lawyer routing | **counsel** | P2 dispute letters carrying damages language; the adversarial-work routing boundary (`docs/05` §2) | [ ] | | |
| OQ-15 | BYO-upload identity-match policy (thresholds, mismatch = immediate purge, appeal path) | safety | P1.5 Datenkopie ingest accepting any upload | [ ] | | |
| OQ-16 | HIBP data-transfer assessment (Art. 44 ff.) + tier choice (Core direct-email vs Pro k-anonymity) | counsel + engineering | Breach monitoring (`BreachMonitor`) going live | [ ] | | |
| OQ-17 | Enrichment-broker instrument + template: confirm Art. 17 + Art. 21(1) framing (not 21(2)); whether to cite CNIL/KASPR and the Art. 14 breach explicitly | **counsel** | Enabling all 7 `loeschung.*datenhaendler`/broker playbooks (and per their own headers: the hireright/hirevue/retorio drafts) | [ ] | | |
| OQ-18 | Is the Self-Exposure Scan module (`docs/10` §7.5) in scope at all given its dual-use profile; if so, its self-binding contract | safety + product | Building the scanner at all (deliberately NOT built) | [ ] | | |
| OQ-19 | Email as a subject-identifier for email-keyed brokers: derived email field vs name+address only with the email-keyed path on the self-serve route (touches the closed `subjectFields` enum, ADR-009) | **safety + counsel** | Any letter identifying the subject by email; template disambiguation for brokers | [ ] | | |
| OQ-20 | Art. 77 venue for non-EU brokers = user's habitual-residence Land-DPA; resolve one-stop-shop nuance for brokers WITH an EU establishment (Cognism GmbH/DE, KASPR SAS/FR) | **counsel** | Drafting escalations for the broker playbooks; `seatDpa` values | [ ] | | |
| OQ-21 | Clock/escalation model for controllers with no German postal channel: is `onDeadlineExpiry: NONE` (no silence-escalation) the intended posture, or model a standalone Art.-14/unlawful-processing complaint path? | engineering + counsel | The silence posture of all US/UK-broker playbooks | [ ] | | |
| OQ-22 | Art. 22(3) is a distinct right currently carried on `requestType: ACCESS_ART15` — partial compliance can read as full, and the idempotency key collides with a plain Datenkopie; dedicated `requestType` (e.g. `HUMAN_REVIEW_ART22`)? | counsel + engineering | Enabling `explanation.hirevue` / `explanation.retorio` | [ ] | | |

---

## 3. Template sign-off matrix

Every file in `templates/` is marked DRAFT in its own header and requires German data-protection + RDG
counsel approval before any use (`ARCHITECTURE-DECISIONS.md` §4 item 1; `docs/05` checklist). Templates
carry no version field of their own; per `docs/04` ("legal wording lives only in `templates/`,
counsel-reviewed") sign-off is recorded against the **binding playbook's `version`** — all bindings are
at v1 per `playbooks/.shipped.json`. Bindings verified by grep over `playbooks/*.yaml` `template:` keys;
all 15 playbooks and all 7 templates are covered, no orphans in either direction.

| Template | Bound playbooks | Statutory basis (from the file's own content) | Sign-off status | Version | Sign-off | Datum | Notizen |
|---|---|---|---|---|---|---|---|
| `templates/art21-werbewiderspruch.de.md` | `werbewiderspruch.az-direct` | Art. 21 Abs. 2 DSGVO (unbedingter Werbewiderspruch, inkl. Profiling); Umsetzung Art. 21 Abs. 3; Frist Art. 12 Abs. 3; Ausweis nicht erforderlich (Überschusserhebung-Hinweis) | PENDING | DRAFT / unversioned (binding at playbook v1) | [ ] | | |
| `templates/art15-datenkopie.de.md` | `datenkopie.schufa` | Art. 15 DSGVO Auskunft + kostenlose Datenkopie nach Art. 15 Abs. 3; enumeriert Art. 15 Abs. 1 lit. c, d, g, h; engine-derived `{{#if identityProofEnclosed}}` wrapper (confirm meaning when omitted, `:12`) | PENDING | DRAFT / unversioned (v1) | [ ] | | |
| `templates/art15g-herkunft.de.md` | `provenance.schufa`, `provenance.infoscore` | Art. 15 Abs. 1 lit. g DS-GVO (Herkunft, quellenscharf pro Datenkategorie); Abgleich mit der eigenen Art.-14-Information (Schufa-Variante zitiert Ziffer 2.3 "Datenlieferanten" wörtlich); same wrapper confirmation (`:13`) | PENDING | DRAFT / unversioned (v1 ×2) | [ ] | | |
| `templates/art15h-22-3.de.md` | `explanation.hirevue`, `explanation.retorio` | Art. 15 Abs. 1 lit. h DS-GVO (Logik, tatsächlich angewandte Grundsätze — EuGH C-203/22, kein pauschales Geschäftsgeheimnis) i.V.m. Art. 22 Abs. 3 (menschliches Eingreifen, Standpunkt, Anfechtung); Controller/Processor-Adressat per case (`:13`) | PENDING | DRAFT / unversioned (v1 ×2) | [ ] | | |
| `templates/art15-17-screening.de.md` | `loeschung.hireright` | Art. 15 DS-GVO Auskunft (inkl. lit. g) + Art. 17 Abs. 1 lit. d Löschung unrechtmäßig erhobener Screening-Daten; Grenzen: Art. 10 DS-GVO + §§ 32, 51, 53 BZRG, Art. 9, private Social-Media, Schufa-in-hiring; Controller/Processor per case (`:16`) | PENDING | DRAFT / unversioned (v1) | [ ] | | |
| `templates/art17-datenhaendler.de.md` | `loeschung.zoominfo`, `loeschung.apollo`, `loeschung.lusha`, `loeschung.cognism`, `loeschung.peopledatalabs`, `loeschung.rocketreach`, `loeschung.generic-datenhaendler` (stencil) | Art. 17 Abs. 1 i.V.m. Art. 21 Abs. 1 DSGVO; Unrechtmäßigkeit geführt über den Art.-14-Transparenzverstoß, Art. 17(1)(d) (KASPR-Argument sekundär/hedged) + Art. 21(1)→17(1)(c)-Brücke; identifies by `legalName` only (minimisation, OQ-19); open: KASPR citation, English variant (`:31`, `:33`) | PENDING | DRAFT / unversioned (v1 ×7) | [ ] | | |
| `templates/art17-loeschung.de.md` | `loeschung.generic-adresshaendler` (stencil) | Art. 17 Abs. 1 DSGVO Löschung, aufbauend auf erklärtem Art. 21 Abs. 2 Widerspruch; NICHT für Auskunfteien (`:20`); optional objection-date variant (`:15`) | PENDING | DRAFT / unversioned (v1) | [ ] | | |

---

## 4. Playbook activation checklist

Source: `ARCHITECTURE-DECISIONS.md` §4 (the human checklist) + `playbooks/.shipped.json` (all 15 at
`version: 1`, hashes sealed) + each playbook's own header. All 15 are `active: false`; the two stencils
(`parameterised: true`) may **never** be `active: true` (ADR-018) — they are cloned per controller and the
clone enters this list. Common preconditions for every flip, before the per-row items:

1. Bound template signed (§3) — `ARCHITECTURE-DECISIONS.md:547`.
2. Every recipient address/endpoint re-verified against the controller's **live Datenschutz page**
   (`docs/07-controllers-seed.md:3–5`; `docs/09-pivot-modules.md:61`; `ARCHITECTURE-DECISIONS.md:548`).
3. Seat/DPA confirmed where the playbook can escalate (`docs/07-controllers-seed.md:12–15`).
4. The flip recorded against the playbook `version` (§4 last item; `docs/04`: never mutate a shipped version).

| Playbook (slug) | v | requestType | Channel(s) | Escalation venue | active | Counsel must verify before flipping | Sign-off | Datum | Notizen |
|---|---|---|---|---|---|---|---|---|---|
| `werbewiderspruch.az-direct` | 1 | OBJECTION_ART21 | email → postal (registered fallback) | LDI NRW per `docs/07:35` (no `seatDpa` field declared) | false | Endpoints (`:18–19`); template §3; venue confirm | [ ] | | |
| `datenkopie.schufa` | 1 | ACCESS_ART15 | postal (registered primary) → web_form | HBDI per `docs/07:21` (no `seatDpa` field declared) | false | Endpoints + current Datenkopie route (`:18–19`, header NOTE); OQ-10 (redacted_id required); venue confirm | [ ] | | |
| `provenance.schufa` | 1 | ACCESS_ART15_SOURCE | postal (registered primary) → web_form | `seatDpa: HBDI` (Wiesbaden) | false | Endpoints (`:20–21`); OQ-10; "Datenlieferanten"-Klausel framing in template §3; venue confirm | [ ] | | |
| `provenance.infoscore` | 1 | ACCESS_ART15_SOURCE | postal (registered primary) → web_form | `seatDpa: LFDI_BW` (Stuttgart) | false | **OQ-8 (blocking per ADR §3)**: verify the Art.-14 notice version (V7, Aug 2026) before the `contradictsArt14` Art.-77 trigger is live; endpoints (`:21–22`); OQ-10; Boniversum→infoscore routing; venue confirm | [ ] | | |
| `loeschung.generic-adresshaendler` | 1 | ERASURE_ART17 | email → postal (registered fallback) | per instantiated controller | false (stencil — never activatable) | Template `art17-loeschung.de` §3; per-clone endpoints + venue (`:20`, `:22`) | [ ] | | |
| `loeschung.generic-datenhaendler` | 1 | ERASURE_ART17 | email → web_form | user's habitual-residence Land-DPA (OQ-20) | false (stencil — never activatable) | OQ-17 instrument sign-off; OQ-20 venue; OQ-21 silence posture (`onDeadlineExpiry: NONE`) | [ ] | | |
| `loeschung.zoominfo` | 1 | ERASURE_ART17 | email → web_form | user's Land-DPA (OQ-20); Art.-27 rep VeraSafe IE | false | OQ-17; OQ-20; OQ-21; endpoints (`:18–19`) | [ ] | | |
| `loeschung.apollo` | 1 | ERASURE_ART17 | email → web_form | user's Land-DPA (OQ-20) | false | OQ-17; OQ-20; OQ-21; endpoints (`:16–17`); suppression-list demand stands | [ ] | | |
| `loeschung.lusha` | 1 | ERASURE_ART17 | email → web_form | user's Land-DPA (OQ-20); Art.-27 rep DP-Dock GmbH, Hamburg | false | OQ-17; OQ-20 (rep ≠ main establishment); OQ-21; endpoints (`:17–18`) | [ ] | | |
| `loeschung.cognism` | 1 | ERASURE_ART17 | email → web_form | user's Land-DPA lodging; **OSS/lead-SA nuance open (OQ-20)** — UK controller, EU estabs Cognism GmbH/DE + KASPR SAS/FR | false | OQ-17; **OQ-20 controller entity + OSS**; OQ-21; endpoints (`:20–21`) | [ ] | | |
| `loeschung.peopledatalabs` | 1 | ERASURE_ART17 | email → web_form | user's Land-DPA (OQ-20); no EU rep disclosed | false | OQ-17; OQ-20; OQ-21; endpoints (`:16–17`); Art.-19 recipient-notification demand relevance | [ ] | | |
| `loeschung.rocketreach` | 1 | ERASURE_ART17 | email → web_form | user's Land-DPA (OQ-20); Art.-27 rep VeraSafe IE | false | OQ-17; OQ-20; OQ-21; endpoints (`:16–17`) | [ ] | | |
| `loeschung.hireright` | 1 | ERASURE_ART17 | email → web_form | not declared; refusal-only escalation (`onDeadlineExpiry: NONE`) | false | OQ-17 (per file header); controller-vs-processor per case (template `:16`); endpoints (`:18–19`); §7.4 screening-limits framing | [ ] | | |
| `explanation.hirevue` | 1 | ACCESS_ART15 | email only | not declared; refusal-only escalation (US vendor) | false | **OQ-22 (blocking per ADR §3)**; OQ-17 (per file header); DSAR intake / EU representative (`:17`); controller = employer vs vendor per case | [ ] | | |
| `explanation.retorio` | 1 | ACCESS_ART15 | email only (upgrade path in header) | to be set: `seatDpa: BAYLDA` on activation (header `:4–7`) | false | **OQ-22**; OQ-17; pre-activation bundle `:4`: verify Munich postal address, add registered postal fallback, switch `onDeadlineExpiry: DRAFT_ART77`, note Art. 9 (biometric) exposure; DSAR intake (`:18`) | [ ] | | |

The remaining ADR §4 items that are not per-playbook (provider contracts, DPIA, EU residency
confirmation) are carried in §7.

---

## 5. CoC rules-engine sign-off (S1–S7 + P1.5)

Source: `docs/10-utility-roadmap.md` §2.1 (score levers, verified Aug 2026) and §3.2 P1.5 (the
retention/error rules engine). The engine encodes deterministic date/error rules from the
Verhaltensregeln (Code of Conduct) of the Auskunfteien plus dispute levers; per §3.2 the rule set is
"**versioned, effective-dated, counsel-signed** like templates". Per **OQ-13** the sign-off process
itself (who approves a rule-set version) is an open counsel question — until rule-set v1 is signed,
findings from `packages/core` may be presented to users **only as preliminary**, never as established
legal findings. What exists in code today: the versioned applicant-retention engine
(`packages/core/src/retention/applicant.ts`, `APPLICANT_RETENTION_RULESET_VERSION = 1`, ADR-025 — its
four `TODO(counsel)` markers are in §1b); the bureau-CoC rule set is a **separate** rule set being built
as the P1.5 deliverable under the ADR-028 follow-up (`docs/10` §3.2; `AUDIT-2026-08-11-ALPHA.md`).

| # | Lever (condensed) | Statutory basis / mechanism (as cited in docs/10 §2.1) | Certainty (per docs/10) | Sign-off | Datum | Notizen |
|---|---|---|---|---|---|---|
| S1 | Settled-claims deadline engine: delete negative entries past CoC deadlines (3y settled; 18 months where settled ≤100 days + no further negatives, live since 1 Jan 2025) | CoC IV.1b; HBDI announcement; BGH I ZR 97/25 (18 Dec 2025) upheld the framework, case-by-case "besondere Umstände" possible | High | [ ] | | |
| S2 | Wrong/premature negative-entry disputes: formal-prerequisite checks, Art. 16 dispute to bureau + reporting creditor, Klärungsfall freeze | Art. 16 / Art. 5(1)(d); damages anchors BGH VI ZR 183/22 (€500) and VI ZR 67/23 | High | [ ] | | |
| S3 | RSB / insolvency cleanup: Restschuldbefreiung flag deleted at 6 months + all claims covered by the proceedings; Schuldnerverzeichnis early end via Löschbescheinigung | CoC IV.2a/b; CJEU C-26/22 + C-64/22 | High | [ ] | | |
| S4 | Refusal-response pack after a score-based refusal: Art. 15(1)(h) individualised logic disclosure + Art. 22(3) human review/contest | CJEU C-634/21; C-203/22; VG Wiesbaden 6 K 788/20.WI; hardening via § 37a BDSG in force 20 Nov 2026 | High | [ ] | | |
| S5 | Inquiry hygiene: Kreditanfrage→Konditionsanfrage recoding disputes; CoC IV.6 early deletion of inquiry data on request after 12 months | CoC IV.6 | High | [ ] | | |
| S6 | Fraud repair: dispute fraud-caused entries; individualised deletion case | Art. 16/17; BGH I ZR 97/25 balancing | Medium-high (per case) | [ ] | | |
| S7 | Provenance purge at infoscore: broker-sourced address/neighbourhood layer | Art. 15(1)(g) → 17(1)(d) chain; Austrian DSB / BayLDA precedent | Medium | [ ] | | |

Additional sign-off items attached to this rule set:

| Item | Source | Sign-off | Datum | Notizen |
|---|---|---|---|---|
| Score-negative guardrails: CoC IV.3a early deletion of terminated-contract data and aggressive address-history pruning are privacy-positive but score-negative — the product must warn before these actions; the 12-criteria table is encoded as data so warnings are computed | `docs/10` §2.1 "Score guardrails"; `docs/05` §3 | [ ] | | |
| Rule-set v1 sign-off process itself: who approves a rule-set version (OQ-13); a shipped version is never mutated | `docs/10` §3.3 OQ-13; §3.2 P1.5 | [ ] | | |
| **§ 37a BDSG re-audit (calendar item: Nov 2026).** In force 20 Nov 2026; bans address data, age, gender, name, social-network and account-flow data from scoring — Schufa's "Alter der aktuellen Adresse" (94 pts) is in visible tension. Plan the criteria re-audit + template re-check; OQ-13 also asks who owns this re-audit | `docs/10-utility-roadmap.md:71–74` (`TODO(counsel)` at `:74`) | [ ] | | |

---

## 6. Governing frame (`docs/05-legal-guardrails.md`)

`docs/05` is the normative legal frame for everything above; this packet cites it and does not restate
it. Counsel should read it first and treat its own checklist (§ "Counsel checklist", lines 86–91) as part
of this packet:

- **§1 Framing** — rights agent, not request cannon: individualised, user-initiated requests; no bulk
  Art. 15 sweep (Digital-Omnibus posture).
- **§2 Mandate (Vollmacht) and RDG** — QES-signed Mandate for adversarial acts; Botendienst framing for
  plain objections/access; Inkassodienstleister vs partner-lawyer structure to be chosen with counsel
  (→ OQ-14); Japan carve-out.
- **§3 No promised outcomes** — no score or deletion promises, anywhere (also binds §5's findings copy).
- **§4 Scraper as controller** — DPIA mandatory, DPO, own Art. 15/17 duties.
- **§5 Data-subject accuracy (Art. 5(1)(d))** — never submit false identity data.
- **§6 Evidence and the statutory clock** — provable send only; Einwurf-Einschreiben + qualified eIDAS
  timestamp; provisional vs statutory deadline; the one-rule-in-three-places (`CLAUDE.md` §6,
  `docs/05` §6, `schema/request-state-machine.md`) — change all three or none (→ OQ-11; fresh-month
  `TODO(counsel)` at `docs/05:75`).
- **§7 Public scoreboard (deferred)** — verifiable facts only; defamation/UWG exposure.

---

## 7. Fastest path to the first real send

Derived from `ARCHITECTURE-DECISIONS.md` §4 ("Before the first real letter is sent"), ordered by
dependency. ADR §4's item "OQ-1 and OQ-5 resolved" is already satisfied as a spec matter (ADR-012,
ADR-016), but each left an operational successor that still gates a send: OQ-11 (what exactly proves the
send) and OQ-10 (producing the IdentityPacket the letters conditionally assert). Two candidate first
sends, stated factually from the files: the flagship `provenance.*` (ADR-023) needs OQ-8/OQ-10 and a
registered-postal chain; `werbewiderspruch.az-direct` needs no identity proof (`identityProof.required:
false`) and its provisional email send needs no postal chain **until** the registered re-send or an
escalation — which one goes first is a product+counsel choice, not resolved here.

1. **Template sign-off** (§3) for the chosen first playbook's template — and ideally all seven in one
   review pass (`docs/05` checklist item 1; ADR §4 item 1).
2. **Endpoint verification** against the live Datenschutz page for that controller, plus seat/DPA
   confirmation (§1d, §4 preconditions; ADR §4 item 2; `docs/07`).
3. **Resolve the send-blocking OQs for that path** (§2): OQ-7 (letter envelope — mechanics resolved by
   the P1 renderer either way), OQ-11 (`deadlineAt` trigger); plus OQ-10 and OQ-8 if the first send is a
   provenance/Datenkopie letter; OQ-9 before any second cycle.
4. **Ident-provider contract** signed and the `IdentityProvider` stub replaced (ADR §4 item 3) — the
   identity gate is real from commit one; no real send exists without a verified identity.
5. **Hybrid-mail account with Einwurf-Einschreiben capability** (`PostalProvider`, ADR §4 item 4) —
   required for any statutory clock, including the registered re-send behind an email-first send.
6. **eIDAS QTSP account** for qualified timestamps (`Timestamper`, ADR §4 item 5) — clock-critical
   evidence anchoring.
7. **EU-region hosting and EU-region model inference confirmed in writing** for personal data
   (ADR §4 item 6).
8. **DPIA completed and signed off; DPO appointed** (ADR §4 item 7; `docs/05` §4, `docs/06`).
9. **Flip exactly one playbook to `active: true`**, deliberately, with the counsel sign-off recorded
   against its `version` in §4 above (ADR §4 last item) — then repeat §4 row by row.

| Step | Done | Datum | Notizen |
|---|---|---|---|
| 1. Template sign-off (first playbook) | [ ] | | |
| 2. Endpoint + venue verification (first controller) | [ ] | | |
| 3. Blocking OQs resolved for that path | [ ] | | |
| 4. Ident-provider contract + stub replaced | [ ] | | |
| 5. Einwurf-Einschreiben capability live | [ ] | | |
| 6. QTSP account live | [ ] | | |
| 7. EU hosting + inference confirmed in writing | [ ] | | |
| 8. DPIA signed, DPO appointed | [ ] | | |
| 9. First playbook flipped, sign-off recorded against version | [ ] | | |
