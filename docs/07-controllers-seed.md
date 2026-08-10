# 07 — Phase 0 census seed (~10–20 controllers)

The hand-curated starting census. **Verify every channel/address with counsel and from the controller's
current Datenschutz page before use** — the values below are starting points, not confirmed endpoints
(`TODO(counsel)` on each). The mix is chosen so Phase 0 exercises all three request types and both
channels (email + postal).

> **Retarget:** `docs/09-pivot-modules.md` supersedes the people-search framing of this census. The
> bureaus that *buy broker data* and the brokers they name are now the primary targets; the directory
> and delisting sections below are retained but are no longer the focus.

**On the `seat / DPA` column.** It is the competent supervisory authority for an Art. 77 complaint,
sourced from `docs/09` and mirrored by the `seatDpa` field in `playbooks/*.yaml`. A wrong venue misroutes
a complaint, so every value here is `TODO(counsel)` — confirm the registered seat before enabling any
playbook that escalates.

## Credit bureaus (Auskunfteien) — request types: ACCESS_ART15_SOURCE (provenance, flagship) + ACCESS_ART15 (Datenkopie); later correction, not deletion
| slug | name | why | channel | seat / DPA (`TODO(counsel)`) |
|---|---|---|---|---|
| infoscore | infoscore Consumer Data GmbH (Experian Deutschland) | **PRIMARY provenance target.** Its own Art. 14 notice names AZ Direct as an address source and admits neighbourhood defaults enter the score — the "we only identify people" defence is unavailable to it. Playbook: `provenance.infoscore` | postal + web-form | Baden-Baden / **LfDI Baden-Württemberg** |
| schufa | SCHUFA Holding AG | the anchor; free Datenkopie (Art. 15); new 12-criteria score; Art. 14 notice §2.3 discloses an undefined **"Datenlieferanten"** channel no regulator has probed. Playbooks: `provenance.schufa`, `datenkopie.schufa` | web-form + postal | Wiesbaden / **HBDI** |
| crif | CRIF GmbH (ex-Bürgel) | 62M+ records; BayLDA scrutiny; second LfDI-BW-venued bureau, so provenance escalations pool at one authority | postal/email | Karlsruhe / **LfDI Baden-Württemberg** |
| regis24 | Regis24 GmbH | identity/address data only, **no scoring** — but Art. 15(1)(g) and Art. 21 still apply, and it appears on the Schufa provenance watchlist | postal/email | Berlin / **BlnBDI** |
| boniversum | Creditreform Boniversum GmbH | ~~consumer arm of Creditreform~~ — **merged into infoscore (Sep 2025); route Boniversum requests to `infoscore`.** Kept as a slug alias so historical references resolve; do not write a playbook against it | — | see `infoscore` |

> Credit bureaus are **not** an erasure target — the levers are access, provenance, correction, retention
> enforcement, and (later) automated-decision explanation. The one exception `docs/09` adds: where a
> provenance answer names a broker as the source of a category, that category may be attacked at the
> bureau under Art. 17(1)(d) (unlawful origin) — a targeted deletion of a broker-sourced layer, never a
> blanket erasure of the file.

## Address / marketing-data traders (Adresshändler) — request type: OBJECTION_ART21 (+ ACCESS_ART15, ERASURE_ART17)
| slug | name | why | channel | seat / DPA (`TODO(counsel)`) |
|---|---|---|---|---|
| az-direct | AZ Direct GmbH (Bertelsmann) | core marketing-list broker; **named by infoscore's own Art. 14 notice**, so it is the first provenance follow-up target; CRIF-ruling relevance. Playbook: `werbewiderspruch.az-direct` | email + postal | Gütersloh / **LDI NRW** |
| deutsche-post-direkt | Deutsche Post Direkt GmbH | postal/marketing data. **Note:** Werbewiderspruch and Löschung are mutually exclusive here — file both and demand written confirmation of which was applied (`docs/09`) | postal + email | Troisdorf / **LDI NRW** |
| schober | Schober Information Group | marketing profiles; parent of `capaneo` | email + postal | Leinfelden-Echterdingen / **LfDI Baden-Württemberg** |
| capaneo | Capaneo GmbH (Schober Information Group) | Schober's marketing-data arm — `docs/09` routes Schober→Capaneo; on both provenance broker watchlists | email + postal | Leinfelden-Echterdingen / **LfDI Baden-Württemberg** |
| acxiom | Acxiom Deutschland GmbH | marketing data; BayLDA/Hessen proceedings | email + postal | **HBDI** (Hessen) |
| postadress | Deutsche Post Adress GmbH & Co. KG | address-verification / Umzugsdatenbank supplier; on the `provenance.schufa` broker watchlist. **A distinct legal entity from `deutsche-post-direkt`** — do not conflate the two slugs | postal + email | Gütersloh / **LDI NRW** |

> Art. 21(2) marketing objection is **unconditional** — highest-win-rate target. If a controller demands
> a full ID copy just to process a marketing objection, that is over-collection; the template pushes back
> and we provide only a redacted ID if strictly necessary.

## Directories & opt-out lists — request types: OBJECTION_ART21 / ROBINSON / ERASURE_ART17
| slug | name | why | channel |
|---|---|---|---|
| robinsonliste | DDV Robinsonliste | industry marketing opt-out enrolment | web-form/email |
| dastelefonbuch | Das Telefonbuch | directory listing suppression | web-form |
| dasoertliche | Das Örtliche | directory listing suppression | web-form |
| 11880 | 11880.com | directory listing suppression | web-form |

> In Phase 0, `web_form`-only controllers drop to the **human queue** (no L2 browser agent yet).

## Google delisting — request type: ERASURE_ART17 (search delisting) — optional Phase 0 stretch
| slug | name | why | channel |
|---|---|---|---|
| google-eu-delisting | Google (EU RTBF) | search-visibility layer | web-form |

## Recruitment / workforce data & B2B enrichment brokers (docs/10 §7) — request type: ERASURE_ART17 (+ ACCESS_ART15, OBJECTION_ART21 Abs. 1)

Added by the docs/10 §7 research round. These scrape LinkedIn/Xing and sell professional contact
profiles to sales teams and recruiters. **The instrument is Art. 17 erasure + Art. 21(1) general
objection — NOT the Art. 21(2) marketing objection** (this is sales/recruiting intelligence, not direct
marketing; see `templates/art17-datenhaendler.de`). Most offer a **self-serve opt-out form** — the
cheapest, primary rung (`SelfServeRoute`, docs/08 Tier 1); the legal letter is the escalation. The
flagship precedent is the **CNIL KASPR fine (€240,000, Dec 2024)** for scraping LinkedIn contacts.
Venue for an Art. 77 complaint against a controller with no German seat is the **user's own
habitual-residence Land DPA** (Art. 77(1)) — not a fixed bureau seat (OQ-20). `TODO(counsel)` on every
endpoint below; re-verify the live opt-out page before enabling (`[verify]` = confirm exact URL).

All six verified 2026-08-09 (workflow): self-serve opt-out is an **email-code** form (no login, no ID),
performs a **genuine GDPR erasure**, and the record **reappears** (re-scraping + customer re-uploads) —
so the recommended instrument is **self-serve-then-Art.17** with a suppression-list demand.

| slug | name | role | primary self-serve opt-out (verified) | legal-fallback DSAR email | venue / note |
|---|---|---|---|---|---|
| zoominfo | ZoomInfo Technologies LLC | ENRICHMENT_BROKER | `https://www.zoominfo.com/update/remove` (work email + code) | `privacy@zoominfo.com` | US; Art. 27 rep VeraSafe Ireland; no OSS lead → user's Land DPA |
| apollo | Apollo.io (ZenLeads, Inc.) | ENRICHMENT_BROKER | `https://www.apollo.io/privacy-policy/remove` | `privacy@apollo.io` | US; Art. 27 rep Lionheart Squared; demand suppression list |
| lusha | Lusha Systems, Inc. | ENRICHMENT_BROKER | `https://www.lusha.com/privacy-center/request-removal/` | `privacy@lusha.com` | US; **Art. 27 rep DP-Dock GmbH, Hamburg** |
| cognism | Cognism Limited (UK) | ENRICHMENT_BROKER | `https://cognism.privacy.saymine.io/cognism` | `privacy@cognism.com` | UK + **EU estabs (Cognism GmbH/DE, KASPR SAS/FR)** → OSS nuance; owns the fined Kaspr |
| peopledatalabs | People Data Labs, Inc. | ENRICHMENT_BROKER | `https://privacy.peopledatalabs.com/` | `privacy@peopledatalabs.com` | US; no EU rep disclosed; ~14-day deletion |
| rocketreach | RocketReach LLC | ENRICHMENT_BROKER | `https://rocketreach.co/remove-profile` | `privacy@rocketreach.co` | US; Art. 27 rep VeraSafe Ireland |

> **Reappearance caveat (surface in-product):** these profiles re-aggregate from public sources, so a
> one-shot deletion often re-lists. The tested posture is claim-and-correct + suppression-list + periodic
> re-suppression (the letter demands the suppression list for exactly this reason), monitored.

**AI screeners & background-screening firms (docs/10 §7.7 targets #3, #4 — now playbooked, active:false):**

| slug | name | type | playbook / lever |
|---|---|---|---|
| hirevue | HireVue | AI_SCREENER | `explanation.hirevue` — Art. 15(1)(h) + Art. 22(3) human review |
| retorio | Retorio (DE) | AI_SCREENER | `explanation.retorio` — Art. 15(1)(h)/22(3) + Art. 9 (biometric) |
| hireright | HireRight | SCREENING | `loeschung.hireright` — access + Art. 17(1)(d) erasure of unlawfully-collected data |

**ATS / HCM — documented, not yet playbooked** (processors → the route is a request to the **employer**;
the retention lever is the docs/10 §7.7 #2 applicant-retention engine, not a per-vendor playbook):

| slug | name | type | route |
|---|---|---|---|
| workday | Workday | HR_TECH | request to the employer (controller); ~6-month applicant-data limit |
| personio | Personio (DE) | HR_TECH | request to the employer; German applicant-retention rule |
| sapsuccessfactors | SAP SuccessFactors | HR_TECH | request to the employer |

**Source-hardening (docs/10 §7.7 target #5, the SAFE part — Tier-1 guided self-serve, no playbook):**
The professional networks the enrichment brokers re-scrape. Prevention is the user tightening their OWN
visibility/sharing settings (a login-gated guided handoff, `SelfServeRoute` `CONSENT_WITHDRAWAL`). The
dual-use self-exposure SCANNER (docs/10 §7.5) is deliberately NOT built — gated behind OQ-18.

| slug | name | type | route |
|---|---|---|---|
| linkedin | LinkedIn (Microsoft) | OTHER | guided profile-visibility + data-sharing hardening |
| xing | XING / New Work SE (DE) | OTHER | guided privacy-settings hardening |

## What to capture per controller (fills the `Controller` entity)
- exact current channel(s) + endpoint/address (email `datenschutz@…`, web-form URL, or postal address),
- what identity proof it demands to process a request (`identityProofRequired`),
- typical response time (`responseNormDays`),
- the correct legal instrument per request type,
- the matching `playbookSlug`,
- `role` (`BUREAU | BROKER | DIRECTORY`), `seatDpa`, `namesSourcesInArt14`, `art15SourceRouteVerified`
  — the four fields `docs/09` adds to `Controller`.

## Shipped example playbooks (`playbooks/`)
The original scaffold five:
1. `provenance.infoscore` — **flagship.** Art. 15(1)(g) provenance, postal (registered) / web-form
   fallback, `seatDpa: LFDI_BW`.
2. `provenance.schufa` — Art. 15(1)(g) provenance naming the "Datenlieferanten" clause,
   postal (registered), `seatDpa: HBDI`.
3. `datenkopie.schufa` — Art. 15 Datenkopie, postal / web-form, credit bureau.
4. `werbewiderspruch.az-direct` — Art. 21(2) objection, email primary / postal fallback.
5. `loeschung.generic-adresshaendler` — Art. 17 erasure for a marketing broker where the legal basis has
   fallen away (use after an objection where retention is no longer justified). Parameterised: it carries
   `__PARAM__` placeholders and is `active: false`; instantiate per controller before use.

Plus the docs/10 §7 recruitment/broker layer (ADR-024/026): `loeschung.{zoominfo,apollo,lusha,cognism,`
`peopledatalabs,rocketreach}` + `loeschung.generic-datenhaendler` (enrichment brokers, Art. 17 + 21(1)),
`explanation.{hirevue,retorio}` (AI screeners, Art. 15(1)(h) + 22(3)), and `loeschung.hireright`
(background screening). Fifteen playbooks in total.

> **Every** shipped playbook is `active: false`. Flipping one to `true` is a deliberate, counsel-signed
> act recorded against that playbook's `version` — see `ARCHITECTURE-DECISIONS.md` §4.
