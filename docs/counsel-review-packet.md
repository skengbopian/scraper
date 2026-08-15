# Counsel review packet — everything that blocks a real send

**Snapshot:** compiled 2026-08-12 at commit `d0941af`; amended 2026-08-13 for port wave 4 (§8);
**amended 2026-08-15** — the OQ collision resolved (§2), and §3/§4 made GENERATED from the corpus.

Those two tables are no longer transcribed. `tools/spec-audit/counsel-packet.mjs` derives their
mechanical columns from `playbooks/*.yaml`, `playbooks/.shipped.json` and `templates/.signoff.json`,
and CI fails when they drift — because they had. §3 asserted "all bindings are at v1" and §4 "all 19
at `version: 1`" while thirteen playbooks had shipped v2 or v3, and the `werbewiderspruch.az-direct`
row — the first letter this product intends to send — said "no `seatDpa` field declared" against a
playbook declaring `seatDpa: LDI_NRW`. Your sign-off, Datum and Notizen cells are never touched by
the generator. Other file/line references are to the snapshot above; re-run
`grep -rn "TODO(counsel)"` after any edit.

This packet is the single organised handoff for German data-protection **and RDG** counsel. It compiles —
without resolving — every open legal question, draft template, unverified endpoint, and counsel-gated
activation decision currently recorded in the repo, so that counsel can clear, item by item, everything
that stands between the built engine and the first real outbound request. It is a compilation with
citations, not a legal analysis: nothing in it takes a position, and **nothing it lists is enabled until
signed** — every playbook ships `active: false` (verified against `playbooks/.shipped.json`), all eight
templates are `DRAFT` in `templates/.signoff.json`, and flipping any playbook to `active: true` is a
deliberate human act recorded against that playbook's `version` (`ARCHITECTURE-DECISIONS.md` §4,
`docs/04-playbook-spec.md`). How to use it: work through §§1–5 in order, mark each row's sign-off box with
date and notes; §6 names the governing legal frame; §7 orders the shortest route to the first real send.
Per `docs/04`, a signed artefact is never mutated — a change after sign-off bumps the `version` and
re-enters review.

Sections:

1. [`TODO(counsel)` inventory](#1-todocounsel-inventory) — every marker in the repo, by file:line.
2. [Open questions OQ-7 … OQ-31](#2-open-questions-oq-7--oq-31) — the decisions no coding agent may take.
3. [Template sign-off matrix](#3-template-sign-off-matrix) — 8 templates, their playbook bindings, statutory basis.
4. [Playbook activation checklist](#4-playbook-activation-checklist) — 19 playbooks, per-slug verification before `active: true`.
5. [CoC rules-engine sign-off](#5-coc-rules-engine-sign-off-s1s7--p15) — S1–S7 levers, rule-set versioning, § 37a BDSG re-audit.
6. [Governing frame](#6-governing-frame-docs05-legal-guardrailsmd) — `docs/05-legal-guardrails.md`, cited not restated.
7. [Fastest path to the first real send](#7-fastest-path-to-the-first-real-send) — ordered, from `ARCHITECTURE-DECISIONS.md` §4.
8. [Port wave 4 — the leverage-ladder tranche](#8-port-wave-4--the-leverage-ladder-tranche) — the four playbooks ported from the pre-audit line, and the 12 that were **not**.

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

## 2. Open questions OQ-7 … OQ-31

OQ-1 … OQ-6 are **CLOSED** (resolved as spec edits, `ARCHITECTURE-DECISIONS.md` §3 / ADR-011..017) and
omitted. OQ-7..10 and OQ-17..27 are recorded in `ARCHITECTURE-DECISIONS.md` §3; OQ-11..16 are recorded in
`docs/10-utility-roadmap.md` §3.3 (flagged there to feed into ADR §3); OQ-28..31 are recorded in
`docs/14-decentralised-deployment.md` §7 (the 2026-08-14 decentralised-launch pivot). Nothing in this
table may be resolved in code — each needs the named owner's decision.

**This table is the complete index; every number resolves to exactly one question.** It did not until
2026-08-15: the pivot minted OQ-23..26 for four questions ADR-036 had already given those numbers to,
and this very section listed the pivot's meanings while §8 and the §4 playbook table listed ADR-036's.
A counsel writing "OQ-25: confirmed" would have been confirming one of two unrelated things. The
pivot's four moved to OQ-28..31 (the ADR-036 numbers were the ones already cited from individual
playbook rows and from `apps/worker`), and OQ-27 — minted in a source comment during port wave 5 and
registered nowhere — was written into the register rather than reused. `ARCHITECTURE-DECISIONS.md` §3
carries the allocation table; the next number to mint is 32.

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
| OQ-23 | Art. 17 Abs. 1 lit. d as the instrument for a **partial** erasure at an Auskunftei, scoped to the categories the bureau itself attributed to a Datenlieferant; and whether chaining it after an Art. 15 request risks being "exzessiv" under Art. 12 Abs. 5. Full text in §8 | **counsel** | All three `loeschung-herkunft.*` playbooks | [ ] | | |
| OQ-24 | Is an **Einwurf-Einschreiben deliverable to a Postfach**? One controller (SCHUFA) now carries two postal endpoints in the corpus. Full text in §8 | **counsel + ops** | The provable clock on 3 SCHUFA playbooks | [ ] | | |
| OQ-25 | **CRIF's Art. 77 venue** — seat vs the shipped München address. Full text in §8; partially resolved 2026-08-14 (`docs/13`: the venue is right, the address is the stale artefact) | **counsel** | `provenance.crif`, `loeschung-herkunft.crif` | [ ] | | |
| OQ-26 | Silence-escalation posture for a controller reachable **only by web form**, where no provable send is possible. Full text in §8b | **counsel** | 12 pre-audit playbooks, deliberately not ported | [ ] | | |
| OQ-27 | Dedicated ops identities: `OpsRoleGuard` reads `User.role`, so an ops operator is an ordinary account with a flag and a compromised ops password is a compromised ops surface. Separate credentials + per-actor attribution in the evidence chain | **safety + engineering** | Not a send blocker; it bounds what an ops compromise costs (`ARCHITECTURE-DECISIONS.md` §3) | [ ] | | |
| OQ-28 | Decentralised posture A (self-host): does Art. 2(2)(c) (purely personal activity) cover a data subject self-hosting to exercise their own rights, and what residual care duties survive if so? (`docs/14-decentralised-deployment.md` §2) | **counsel** | The posture-A launch story; whether `docs/11-dpia.md` binds posture A at all | [ ] | | |
| OQ-29 | Confirm self-representation on posture A engages neither RDG nor a Vollmacht requirement; define where posture B (operating for others) crosses into Rechtsdienstleistung — extends OQ-14 | **counsel** | The launch framing in every user-facing legal description; posture-B viability | [ ] | | |
| OQ-30 | The shipped corpus under decentralisation: what upstream template/playbook sign-off can honestly mean for nodes we never meet; activation-responsibility disclaimer wording; whether any federated statistics aggregation is ever lawful/wise (provenance, defamation, lawful basis) | counsel + product | Corpus release notes; any future aggregation feature (deliberately unbuilt) | [ ] | | |
| OQ-31 | Posture-B safety floor: should readiness refuse playbook activation on an operated node until a real ident provider has verified at least the operator's identity? (`docs/14-decentralised-deployment.md` §4 TODO(safety)) | **safety + counsel** | Posture-B deployment guidance; a possible readiness-gate change | [ ] | | |

---

## 3. Template sign-off matrix

Every file in `templates/` requires German data-protection + RDG counsel approval before any use
(`ARCHITECTURE-DECISIONS.md` §4 item 1; `docs/05` checklist). Sign-off is recorded in
**`templates/.signoff.json`**, against the SHA-256 of the letter's prose after the doc-comment header
is stripped — the exact bytes the worker renders. That is what makes a signature bind to wording
rather than to a filename: `tools/spec-audit/signoff-check.mjs` fails the build if a sealed letter
changes, and `SIGNED` requires a named counsel and a date. Templates carry no version of their own, so
the binding playbook's `version` is shown alongside (`playbooks/.shipped.json`).

The **Seal** and **Binding playbook versions** columns are generated from the corpus; the statutory
basis and the sign-off columns are yours.

<!-- GENERATED:templates BEGIN — do not hand-edit the generated columns; run `npm run packet:write` in tools/spec-audit -->

| Template | Bound playbooks | Statutory basis (from the file's own content) | Seal | Binding playbook versions | Sign-off | Datum | Notizen |
|---|---|---|---|---|---|---|---|
| `templates/art15-17-screening.de.md` | `loeschung.hireright` | Art. 15 DS-GVO Auskunft (inkl. lit. g) + Art. 17 Abs. 1 lit. d Löschung unrechtmäßig erhobener Screening-Daten; Grenzen: Art. 10 DS-GVO + §§ 32, 51, 53 BZRG, Art. 9, private Social-Media, Schufa-in-hiring; Controller/Processor per case (`:16`) | DRAFT · `06639ae9` | v2 | [ ] |  |  |
| `templates/art15-datenkopie.de.md` | `datenkopie.schufa` | Art. 15 DSGVO Auskunft + kostenlose Datenkopie nach Art. 15 Abs. 3; enumeriert Art. 15 Abs. 1 lit. c, d, g, h; engine-derived `{{#if identityProofEnclosed}}` wrapper (confirm meaning when omitted, `:12`) | DRAFT · `d7985bb8` | v2 | [ ] |  |  |
| `templates/art15g-herkunft.de.md` | `provenance.crif`, `provenance.infoscore`, `provenance.schufa` | Art. 15 Abs. 1 lit. g DS-GVO (Herkunft, quellenscharf pro Datenkategorie); Abgleich mit der eigenen Art.-14-Information (Schufa-Variante zitiert Ziffer 2.3 "Datenlieferanten" wörtlich); same wrapper confirmation (`:13`) | DRAFT · `ca5fd42d` | v1 ×3 | [ ] |  |  |
| `templates/art15h-22-3.de.md` | `explanation.hirevue`, `explanation.retorio` | Art. 15 Abs. 1 lit. h DS-GVO (Logik, tatsächlich angewandte Grundsätze — EuGH C-203/22, kein pauschales Geschäftsgeheimnis) i.V.m. Art. 22 Abs. 3 (menschliches Eingreifen, Standpunkt, Anfechtung); Controller/Processor-Adressat per case (`:13`) | DRAFT · `b8bdf890` | v2 ×2 | [ ] |  |  |
| `templates/art17-datenhaendler.de.md` | `loeschung.apollo`, `loeschung.cognism`, `loeschung.generic-datenhaendler` (stencil), `loeschung.lusha`, `loeschung.peopledatalabs`, `loeschung.rocketreach`, `loeschung.zoominfo` | Art. 17 Abs. 1 i.V.m. Art. 21 Abs. 1 DSGVO; Unrechtmäßigkeit geführt über den Art.-14-Transparenzverstoß, Art. 17(1)(d) (KASPR-Argument sekundär/hedged) + Art. 21(1)→17(1)(c)-Brücke; identifies by `legalName` only (minimisation, OQ-19); open: KASPR citation, English variant (`:31`, `:33`) | DRAFT · `ea1bd3cb` | v3 ×7 | [ ] |  |  |
| `templates/art17-loeschung-herkunft.de.md` | `loeschung-herkunft.crif`, `loeschung-herkunft.infoscore`, `loeschung-herkunft.schufa` | **Art. 17 Abs. 1 lit. d DS-GVO — TEILlöschung bei einer Auskunftei**, begrenzt auf die Kategorien, deren Quelle die Auskunftei in ihrer eigenen Art.-15-Abs.-1-lit.-g-Antwort benannt hat; ausdrücklicher Ausschluss des Gesamtbestands und der Vertragsdaten; flankierend Art. 19 (Empfängerunterrichtung) und hilfsweise Art. 18 Abs. 1 lit. b/d (Einschränkung); Begründung: fehlende Rechtsgrundlage nach Art. 6 Abs. 1 bei Erhebung über einen Adress-/Datenhändler | DRAFT · `a446f6e8` | v1 ×3 | [ ] |  |  |
| `templates/art17-loeschung.de.md` | `loeschung.generic-adresshaendler` (stencil) | Art. 17 Abs. 1 DSGVO Löschung, aufbauend auf erklärtem Art. 21 Abs. 2 Widerspruch; NICHT für Auskunfteien (`:20`); optional objection-date variant (`:15`) | DRAFT · `5e48a547` | v3 | [ ] |  |  |
| `templates/art21-werbewiderspruch.de.md` | `werbewiderspruch.az-direct` | Art. 21 Abs. 2 DSGVO (unbedingter Werbewiderspruch, inkl. Profiling); Umsetzung Art. 21 Abs. 3; Frist Art. 12 Abs. 3; Ausweis nicht erforderlich (Überschusserhebung-Hinweis) | DRAFT · `55ca594b` | v2 | [ ] |  |  |

<!-- GENERATED:templates END -->

---

## 4. Playbook activation checklist

Source: `ARCHITECTURE-DECISIONS.md` §4 (the human checklist), `playbooks/*.yaml` and
`playbooks/.shipped.json`. The stencils (`parameterised: true`) may **never** be `active: true`
(ADR-018) — they are cloned per controller and the clone enters this list. Common preconditions for
every flip, before the per-row items:

1. Bound template `SIGNED` in `templates/.signoff.json` (§3) — `ARCHITECTURE-DECISIONS.md:547`.
2. Every recipient address/endpoint re-verified against the controller's **live Datenschutz page**
   (`docs/07-controllers-seed.md:3–5`; `docs/09-pivot-modules.md:61`; `ARCHITECTURE-DECISIONS.md:548`).
3. Seat/DPA confirmed where the playbook can escalate (`docs/07-controllers-seed.md:12–15`).
4. The flip recorded against the playbook `version` (§4 last item; `docs/04`: never mutate a shipped version).

The **v**, **requestType**, **Channel(s)**, **Declared venue**, **Escalates on** and **active**
columns are generated from the YAML and the version lockfile; "Counsel must verify" and the sign-off
columns are yours.

<!-- GENERATED:playbooks BEGIN — do not hand-edit the generated columns; run `npm run packet:write` in tools/spec-audit -->

| Playbook (slug) | v | requestType | Channel(s) | Declared venue | Escalates on | active | Counsel must verify before flipping | Sign-off | Datum | Notizen |
|---|---|---|---|---|---|---|---|---|---|---|
| `datenkopie.schufa` | 2 | ACCESS_ART15 | postal (registered) → web_form | `seatDpa: HBDI` | silence + refusal | false | Endpoints + current Datenkopie route (`:18–19`, header NOTE); OQ-10 (redacted_id required); venue confirm | [ ] |  |  |
| `explanation.hirevue` | 2 | ACCESS_ART15 | email only | `venue: USER_RESIDENCE` (user's Land-DPA) | refusal | false | **OQ-22 (blocking per ADR §3)**; OQ-17 (per file header); DSAR intake / EU representative (`:17`); controller = employer vs vendor per case; US vendor with no German establishment — confirm the Land-DPA lodging route | [ ] |  |  |
| `explanation.retorio` | 2 | ACCESS_ART15 | email only | `seatDpa: BAYLDA` | refusal | false | **OQ-22**; OQ-17; pre-activation bundle `:4`: verify Munich postal address, add registered postal fallback, switch `onDeadlineExpiry: DRAFT_ART77`, note Art. 9 (biometric) exposure; DSAR intake (`:18`) | [ ] |  |  |
| `loeschung-herkunft.crif` | 1 | ERASURE_ART17 | postal (registered) → email | `seatDpa: LFDI_BW` | silence + refusal | false | **OQ-23**; **OQ-25** (same venue/address tension as `provenance.crif`); endpoints (`:29–30`); OQ-10 | [ ] |  |  |
| `loeschung-herkunft.infoscore` | 1 | ERASURE_ART17 | postal (registered) → email | `seatDpa: LFDI_BW` | silence + refusal | false | **OQ-23**; endpoints (`:41–42`); OQ-10; the chain is reachable only after `provenance.infoscore` — confirm that dependency is intended and lawful | [ ] |  |  |
| `loeschung-herkunft.schufa` | 1 | ERASURE_ART17 | postal (registered) → email | `seatDpa: HBDI` | silence + refusal | false | **OQ-23 (blocking)**: the Art. 17(1)(d) partial-erasure framing at a bureau + Art. 12(5) chaining; **OQ-24**: the shipped address is the Kormoranweg street address, not the Postfach used by `datenkopie.schufa`/`provenance.schufa` — confirm which is correct for an Einwurf-Einschreiben; OQ-10 | [ ] |  |  |
| `loeschung.apollo` | 3 | ERASURE_ART17 | email → web_form | `venue: USER_RESIDENCE` (user's Land-DPA) | refusal | false | OQ-17; OQ-20; OQ-21; endpoints (`:16–17`); suppression-list demand stands | [ ] |  |  |
| `loeschung.cognism` | 3 | ERASURE_ART17 | email → web_form | `venue: USER_RESIDENCE` (user's Land-DPA) | refusal | false | OQ-17; **OQ-20 controller entity + OSS**; OQ-21; endpoints (`:20–21`); UK controller with EU establishments Cognism GmbH/DE + KASPR SAS/FR — the OSS/lead-SA question is OQ-20 | [ ] |  |  |
| `loeschung.generic-adresshaendler` | 3 | ERASURE_ART17 | email → postal (registered) | `venue: USER_RESIDENCE` (user's Land-DPA) | silence + refusal | false (stencil — never activatable) | Template `art17-loeschung.de` §3; per-clone endpoints + venue (`:20`, `:22`) | [ ] |  |  |
| `loeschung.generic-datenhaendler` | 3 | ERASURE_ART17 | email → web_form | `venue: USER_RESIDENCE` (user's Land-DPA) | refusal | false (stencil — never activatable) | OQ-17 instrument sign-off; OQ-20 venue; OQ-21 silence posture (`onDeadlineExpiry: NONE`) | [ ] |  |  |
| `loeschung.hireright` | 2 | ERASURE_ART17 | email → web_form | `venue: USER_RESIDENCE` (user's Land-DPA) | refusal | false | OQ-17 (per file header); controller-vs-processor per case (template `:16`); endpoints (`:18–19`); §7.4 screening-limits framing | [ ] |  |  |
| `loeschung.lusha` | 3 | ERASURE_ART17 | email → web_form | `venue: USER_RESIDENCE` (user's Land-DPA) | refusal | false | OQ-17; OQ-20 (rep ≠ main establishment); OQ-21; endpoints (`:17–18`); Art.-27 rep DP-Dock GmbH, Hamburg | [ ] |  |  |
| `loeschung.peopledatalabs` | 3 | ERASURE_ART17 | email → web_form | `venue: USER_RESIDENCE` (user's Land-DPA) | refusal | false | OQ-17; OQ-20; OQ-21; endpoints (`:16–17`); Art.-19 recipient-notification demand relevance; no EU rep disclosed | [ ] |  |  |
| `loeschung.rocketreach` | 3 | ERASURE_ART17 | email → web_form | `venue: USER_RESIDENCE` (user's Land-DPA) | refusal | false | OQ-17; OQ-20; OQ-21; endpoints (`:16–17`); Art.-27 rep VeraSafe IE | [ ] |  |  |
| `loeschung.zoominfo` | 3 | ERASURE_ART17 | email → web_form | `venue: USER_RESIDENCE` (user's Land-DPA) | refusal | false | OQ-17; OQ-20; OQ-21; endpoints (`:18–19`); Art.-27 rep VeraSafe IE | [ ] |  |  |
| `provenance.crif` | 1 | ACCESS_ART15_SOURCE | postal (registered) → email | `seatDpa: LFDI_BW` | silence + refusal + incomplete | false | **OQ-25 (blocking)**: the shipped postal address is in München (BayLDA), while `docs/07:22` and `CLAUDE.md` put CRIF's venue at LfDI BW — confirm the registered seat and correct one of the two; endpoints (`:32–33`); OQ-10 | [ ] |  |  |
| `provenance.infoscore` | 1 | ACCESS_ART15_SOURCE | postal (registered) → web_form | `seatDpa: LFDI_BW` | silence + refusal + incomplete | false | **OQ-8 (blocking per ADR §3)**: verify the Art.-14 notice version (V7, Aug 2026) before the `contradictsArt14` Art.-77 trigger is live; endpoints (`:21–22`); OQ-10; Boniversum→infoscore routing; venue confirm | [ ] |  |  |
| `provenance.schufa` | 1 | ACCESS_ART15_SOURCE | postal (registered) → web_form | `seatDpa: HBDI` | silence + refusal + incomplete | false | Endpoints (`:20–21`); OQ-10; "Datenlieferanten"-Klausel framing in template §3; venue confirm | [ ] |  |  |
| `werbewiderspruch.az-direct` | 2 | OBJECTION_ART21 | email → postal (registered) | `seatDpa: LDI_NRW` | silence + refusal | false | Endpoints (`:18–19`); template §3; venue confirm | [ ] |  |  |

<!-- GENERATED:playbooks END -->

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

---

## 8. Port wave 4 — the leverage-ladder tranche

Source: `docs/port-plan-from-A.md` (wave 4) + `ARCHITECTURE-DECISIONS.md` ADR-036. This is the first
section of the packet that concerns the port from the pre-audit line, so it says what it is: the
pre-audit line holds 45 playbooks written against a state machine in which an **email** starts the
statutory clock. None of them was carried over as written. Four were refitted (§3/§4 above); the rest
are listed here, with the ones that need a decision separated from the ones that do not.

### 8a. What was ported, and the one legal capability it adds

The chain `provenance.* → the bureau names a Datenlieferant → Art. 17(1)(d) partial erasure at that
bureau` now exists end to end. `templates/art17-loeschung-herkunft.de.md` is the only new legal wording
in this wave and it is the whole of the legal review here — the three playbooks bound to it differ only
in addressee and venue.

Two properties of that letter counsel should test deliberately, because both are enforced in code and
would be expensive to discover are wrong later:

1. **The demand is bounded by the controller's own answer.** The category list and the named source are
   not free text: they are derived from the stored Art. 15(1)(g) reply, and the source name is
   re-derived from the playbook's counsel-authored `brokerWatchlist` rather than lifted from the
   controller's letter. The engine **refuses to render** the letter if that scope is absent
   (`packages/core/src/provenance/erasure-scope.ts`), because an unsupplied list rendered as nothing and
   turned "Löschung ausschließlich der folgenden Datenkategorien" into an unbounded erasure demand at a
   credit bureau — the instrument `docs/07` forbids — with no error anywhere.
2. **It is unreachable as a user-initiated request.** A plain `ERASURE_ART17` against a credit bureau is
   refused by the router (`INSTRUMENT_NOT_AVAILABLE_FOR_CONTROLLER`). The only path to this letter is a
   human confirming a follow-up proposal derived from a stored provenance answer.

| # | Question | Owner | Blocks | Sign-off | Datum | Notizen |
|---|---|---|---|---|---|---|
| OQ-23 | Is Art. 17 Abs. 1 lit. d the right instrument for a **partial** erasure at an Auskunftei, scoped to the categories the Auskunftei itself attributed to a Datenlieferant? And does chaining it directly after an Art. 15 request risk being deemed "exzessiv" under Art. 12 Abs. 5? | **counsel** | All three `loeschung-herkunft.*` playbooks | [ ] | | |
| OQ-24 | Is an **Einwurf-Einschreiben deliverable to a Postfach**? `datenkopie.schufa` and `provenance.schufa` declare a registered postal channel against `Postfach 10 34 41, 50474 Köln`; the wave-4 playbook uses the Wiesbaden street address instead. One controller now has two postal endpoints in the corpus. Which is correct, and does the answer invalidate the registered channel on the two sealed playbooks? | **counsel + ops** | The provable clock on 3 SCHUFA playbooks | [ ] | | |
| OQ-25 | **CRIF's Art. 77 venue.** `docs/07:22` and `CLAUDE.md` (pivot focus) both place CRIF at LfDI Baden-Württemberg, and the stated benefit of targeting CRIF is that its escalations pool with infoscore's at one authority. The verified postal address is `Leopoldstraße 244, 80807 München` — Bavaria, i.e. BayLDA. Confirm the registered seat; if it is Munich, `seatDpa: LFDI_BW` on both CRIF playbooks is a misroute and the pooling rationale does not hold. | **counsel** | `provenance.crif`, `loeschung-herkunft.crif` | [ ] | | |
| OQ-26 | The deferred silence-escalation set — see §8b. | **counsel** | 12 pre-audit playbooks, not ported | [ ] | | |

### 8b. OQ-26 — the playbooks that were deliberately NOT converted

**The question, in one sentence:** for a controller that offers only a web form and no German postal
address, should a request that goes unanswered be escalated to an Art. 77 complaint, given that we can
prove we *sent* it but not that they *received* it?

**Why this is a decision and not a conversion.** `CLAUDE.md` §6 and `docs/05` §6 fix the rule that only a
provable send — a registered postal delivery anchored with a qualified timestamp — starts the Art. 12(3)
clock, and that **no path into an escalation may rest on a provisional clock**. All 45 pre-audit
playbooks declare `escalation.onDeadlineExpiry: DRAFT_ART77`. For 12 of them there is no postal channel
at all, so no provable send is reachable and the asserted deadline was never legally established.
Converting them would have been a one-character change to the escalation field and a change of legal
posture; they are listed instead.

Note what is NOT in question: escalating on a **refusal** or an **incomplete answer** needs no provable
send, because the controller's own reply proves receipt. That path stays open for all 12 (this line
already uses it for the US/UK brokers under ADR-024, `onDeadlineExpiry: NONE` + `onRefusal: DRAFT_ART77`).
The only thing deferred is escalation on **silence**.

| Controller | Pre-audit playbooks affected | Channel available | Why no provable send |
|---|---|---|---|
| `11880` | `datenkopie`, `loeschung`, `werbewiderspruch` | web form only | no postal address in the census or the playbook |
| `dasoertliche` | `datenkopie`, `loeschung`, `werbewiderspruch` | web form only | as above |
| `dastelefonbuch` | `datenkopie`, `loeschung`, `werbewiderspruch` | web form only | as above |
| `google-eu-delisting` | `datenkopie`, `loeschung`, `werbewiderspruch` | web form only | as above |

Three sub-questions, each of which changes what the product should build:

1. **Is `onDeadlineExpiry: NONE` the right posture** for a controller reachable only by web form — i.e.
   the user is told plainly that silence cannot be escalated, only a refusal can?
2. **Or is a standalone complaint the right answer** — an Art. 77 complaint founded on the transparency
   or lawfulness breach itself, rather than on the non-answer to a letter whose receipt we cannot prove?
   That is a different instrument with a different evidence pack, and it is not built.
3. **Or is a postal address obtainable** for these controllers (Impressum / Handelsregister), making
   them ordinary postal-fallback playbooks? If so, this is a research task, not a legal one.

A fourth consideration is product, not legal, and is recorded so counsel is not asked to rule on it:
`docs/08` treats a directory-listing suppression as a **Tier-1 self-serve** action, and `docs/07` has
already retargeted away from the directory framing. On that reading these 12 belong in the
`SelfServeRoute` directory rather than in `playbooks/` at all, and OQ-26 would be moot for them. The
question is nonetheless real for any future web-form-only controller that is not a directory.

| Step | Done | Datum | Notizen |
|---|---|---|---|
| OQ-23 answered (partial-erasure framing) | [ ] | | |
| OQ-24 answered (Einwurf to a Postfach; the SCHUFA address) | [ ] | | |
| OQ-25 answered (CRIF seat and venue) | [ ] | | |
| OQ-26 answered (silence posture without a provable channel) | [ ] | | |
