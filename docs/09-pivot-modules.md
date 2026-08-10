# 09 — The pivot: three modules, the Art. 15(1)(g) provenance request, and the usability gate

This supersedes the five-module framing in `docs/00-overview.md` §"five product modules". Research
(report §5–6) killed the "counter scraping to protect your Schufa" thesis and replaced it with three
defensible modules on the same engine. Read this before building pivot features.

## Why the pivot (one paragraph)
The new Schufa score is 12 published credit-contract criteria; Schufa uses **no** web/social data;
neighbourhood data appears in ~0.3% of scores. So scraping-defence cannot move a Schufa score, and privacy
hygiene can even *lower* it (thin-file penalty; fraud engines treat clean footprints as risk). But two
channels are real and defensible: **identity fraud** turns leaked data into real negative entries (the
heaviest scoring criterion; ~€10bn German fraud damage in 2025; only 9% of victims notify Schufa), and a
set of bureaus **do** buy broker data — infoscore/Experian's own Art. 14 notice names AZ Direct and admits
neighbourhood defaults enter its score, and Schufa's Art. 14 notice discloses an undefined **"Datenlieferanten"**
source channel no regulator has probed.

## The three modules (all on the engine from `docs/02`/`docs/03`)

### Provenance — "Woher haben die meine Daten?" (flagship)
Force each bureau to name its sources, then purge the broker-sourced layer.
- New `RightsRequest.requestType = ACCESS_ART15_SOURCE` — an **Art. 15(1)(g)** request demanding the
  source of each stored data category. See the template + playbook below.
- New entity **`ProvenanceLedger`** (per user, per bureau): rows of
  `{dataCategory, statedSource, statedLegalBasis, isBroker (bool), confidence, evidenceRecordId}`.
- Chained follow-ups when a broker is named: `ERASURE_ART17` at the bureau (unlawful origin →
  Art. 17(1)(d)); `OBJECTION_ART21` + `ERASURE_ART17` at the named broker (AZ Direct / Acxiom / Deutsche
  Post Direkt / Schober-Capaneo).
- Escalation: silence, refusal, or an **incomplete** source list → draft Art. 77 to the seat DPA
  (BayLDA precedent: an incomplete Art. 15 answer is itself a violation).
- Primary targets + venue: infoscore/Experian (Baden-Baden) and CRIF (Karlsruhe) → **LfDI Baden-Württemberg**;
  Schufa (Wiesbaden) → HBDI for the Datenlieferanten + Schattendatenbank questions.

### Fraud Shield — keep identity fraud off the file
- Detect: breach/stealer-log monitoring (HIBP Pro interface) + alias issuance (Tier 0, `docs/08`).
- Register: guided **Identitätsbetrug-Einmeldung** (Schufa victim marker; does not affect score) +
  equivalents — a guided flow with the pre-verified identity packet, not a form.
- Repair: hand a fraud-caused negative entry to the File Fixer case-builder.
- **Caveat surfaced in-product:** aliases can trigger checkout declines (report §5). Warn before recommend.

### File Fixer — automate the bureaucracy of a correct file
- Ingest: `ACCESS_ART15` Datenkopie to Schufa/CRIF/infoscore → OCR sandbox → normalised credit file
  (same pipeline as Provenance).
- Error-hunting (Klärungsfall dispute), retention enforcement (Code-of-Conduct schedule + BGH
  case-by-case builder), inquiry hygiene (Konditions- vs Kreditanfrage), Art. 15(1)(h)/C-203/22
  explanation-on-demand. **Never** a promised score.

## New/changed data model (Prisma deltas)
- `RightsRequestType` enum: add `ACCESS_ART15_SOURCE` (provenance) and `EINMELDUNG_FRAUD` (victim marker).
- `ProvenanceLedger` + `ProvenanceEntry` entities (above).
- `Controller`: add `role` (`BUREAU | BROKER | DIRECTORY`), `seatDpa` (competent authority),
  `namesSourcesInArt14` (bool), `art15SourceRouteVerified` (bool).
- `LeverageAction.mechanism`: add `PROVENANCE_REQUESTED`, `BROKER_SOURCE_IDENTIFIED`, `FRAUD_MARKER_FILED`.

## Census retarget (Phase 0 seed — supersedes the people-search framing in `docs/07`)
Bureaus: **Schufa** (Wiesbaden/HBDI), **infoscore Consumer Data / Experian** (Baden-Baden/LfDI BW) —
note Boniversum merged into infoscore Sep 2025, route there — **CRIF** (Karlsruhe/LfDI BW),
**Regis24** (Berlin/BlnBDI — identity/address only, no scoring; Art. 15(1)(g) + Art. 21 apply).
Named brokers: **AZ Direct** (Gütersloh/LDI NRW), **Acxiom Deutschland** (HBDI), **Deutsche Post Direkt**
(Troisdorf/LDI NRW — note: Werbewiderspruch and Löschung are mutually exclusive; file both, demand written
confirmation of which applied), **Schober→Capaneo** (Leinfelden/LfDI BW). Verify every address/endpoint
against the live Datenschutz page before enabling (`TODO(counsel)`), and see `docs/05` for RDG structure.

## THE USABILITY GATE (launch-blocking, equal weight to the security gates in `docs/06`)
If the thesis is "bureaucracy is the pain", the product must not feel like bureaucracy. **Standard:** any
German adult — including low German literacy, low digital confidence, or no idea what a credit bureau is —
must understand the risk, the benefit, and their next action from **visual cues and a guided flow**, never
from a written tutorial or a wall of legal text. **Sequencing:** get the functional path working first (a
plain UI is fine — the working provenance request is the highest-return milestone); usability is a launch
gate that must be complete **before onboarding real users**, not before the working functional core.

Concrete, testable requirements (put these in the definition of done for every user-facing feature):
1. **Show, don't tell.** Every screen leads with a picture before words: a data-flow diagram
   (broker → bureau → lender), a red/amber/green file-health dial, a "who holds your data" map.
2. **One decision per screen.** A single plain-language question with a clear default
   ("Möchten Sie diese Firma auffordern, Ihre Daten zu löschen?") — never a multi-field form.
3. **Progress you can see.** Every request renders as a visual pipeline (Gesendet → Frist läuft →
   Antwort → Erledigt) with the statutory deadline as a live countdown. No raw status codes.
4. **Plain language + jargon toggle.** Default German ≈ B1 reading level, with a **Leichte Sprache**
   option; every legal term (Bonität, Auskunftei, Widerspruch, Score) is one tap from a one-sentence
   plain explanation.
5. **Accessibility is the floor.** WCAG 2.2 AA, full screen-reader support, large-text/high-contrast
   modes, works one-handed on a mid-range Android device. The users most harmed by a bad file are least
   likely to be on new hardware.
Deliver, per module, a **user-action-flow diagram** (states + decisions + what the user sees) and the
**visual components** (dial, pipeline, data-flow map) as reusable pieces — after the functional path works,
before real users. Add an automated a11y check (axe) to CI and a "no dead-end screens / every screen states
the next action" review to the DoD.
