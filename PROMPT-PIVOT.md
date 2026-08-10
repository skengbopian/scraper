# Session 3 kickoff prompt — restructure into 3 modules + provenance + usable-by-anyone UX

Paste the fenced block into Claude Code, run in the `scraper/` repo (it loads `CLAUDE.md`). Assumes the
session-1 scaffold (`PROMPT.md`) exists. It restructures the product around the pivot in
`docs/09-pivot-modules.md`, adds the Article 15(1)(g) provenance request, and keeps usability-by-any-German
as a launch gate. **Build order: get a working provenance request end-to-end FIRST — that is the highest-
return proof of the thesis — with a minimal/plain UI; the usable-by-anyone UX is a launch gate that must be
done before onboarding real users, but it comes after the working functional core, not before it.**

```
You are restructuring "Scraper" around a research-driven pivot. Read docs/09-pivot-modules.md FIRST, then
re-read CLAUDE.md, docs/03-data-model.md, docs/04-playbook-spec.md, docs/05-legal-guardrails.md,
docs/06-security-safety.md and docs/08-leverage-ladder.md. The scaffold (data model, RightsRequest state
machine, playbook engine, leverage telemetry) already exists.

CONTEXT FOR YOUR DECISIONS: the new Schufa score uses only credit-contract data — scraping defence cannot
move it, so we do NOT build or claim that. The defensible, high-success work is: (A) PROVENANCE — force
each credit bureau to name where it got the user's data and purge the broker-sourced layer; (B) FRAUD
SHIELD — keep identity fraud off the file (the one channel that really does wreck a score); (C) FILE FIXER
— automate the bureaucracy of a correct file. The bet is that German rights are strong, awareness is near
zero, and the barrier is pure bureaucracy — which is exactly what we automate.

Build order: ship a WORKING provenance request end-to-end FIRST (steps 1–2) with a minimal, plain UI —
that is the highest-return proof of the thesis. Then Fraud Shield and File Fixer (steps 3–4). USABILITY
(step 5) is a launch gate that must be complete before you onboard real users, but it comes AFTER the
working functional core — do not block the first working request on it.

1. DATA MODEL DELTAS (Prisma). Add to RightsRequestType: ACCESS_ART15_SOURCE (provenance) and
   EINMELDUNG_FRAUD (Schufa victim marker). Add entities ProvenanceLedger + ProvenanceEntry
   {dataCategory, statedSource, statedLegalBasis, isBroker, confidence, evidenceRecordId}. Extend
   Controller with role (BUREAU|BROKER|DIRECTORY), seatDpa, namesSourcesInArt14, art15SourceRouteVerified.
   Extend LeverageAction.mechanism with PROVENANCE_REQUESTED, BROKER_SOURCE_IDENTIFIED, FRAUD_MARKER_FILED.
   Migrate; keep the safety invariants from CLAUDE.md (request subject derived from VERIFIED identity;
   idempotency on (user, controller, requestType)).

2. PROVENANCE MODULE (flagship, highest legal-backed success rate). BUILD THIS TO A WORKING END-TO-END
   DEMO FIRST, with a minimal plain UI — a real ACCESS_ART15_SOURCE request that sends, parses a reply,
   writes ProvenanceEntry rows, matches brokers, and drafts follow-ups is the milestone that proves the
   whole thesis. Polish comes in step 5.
   - Wire requestType ACCESS_ART15_SOURCE through the playbook engine. Use template
     templates/art15g-herkunft.de.md (Art. 15(1)(g) "Herkunft der Daten"); it names Schufa's section 2.3
     "Datenlieferanten" verbatim via the isSchufa templateFlag. Load playbooks/provenance.schufa.yaml and
     playbooks/provenance.infoscore.yaml.
   - Parse each bureau's reply in the untrusted-document sandbox (docs/06 rules: structured-output only,
     no tools, output is advisory) into ProvenanceEntry rows. When a source matches the playbook's
     brokerWatchlist, set isBroker and record a BROKER_SOURCE_IDENTIFIED LeverageAction.
   - Chained follow-ups (draft, human-confirm — never auto-send): where a broker is named, create
     ERASURE_ART17 at the bureau (Art. 17(1)(d) unlawful-origin chain) and OBJECTION_ART21 + ERASURE_ART17
     at the named broker. Where the source list is incomplete, silent, refused, OR contradicts the bureau's
     own Art. 14 notice, route to the Art. 77 draft (BayLDA precedent: an incomplete Art. 15 answer is
     itself a violation).
   - Targets + venue: infoscore/Experian (Baden-Baden) and CRIF (Karlsruhe) → LfDI BW; Schufa (Wiesbaden)
     → HBDI. Seed Controller.seatDpa accordingly.

3. FRAUD SHIELD MODULE. Breach/stealer-log monitoring behind an interface (HIBP Pro; stub in dev). Guided
   EINMELDUNG_FRAUD flow (Schufa victim marker — does NOT affect score) using the pre-verified identity
   packet. Surface the honest caveat in-product that privacy aliases can cause checkout declines (report
   §5) — warn before you recommend. Hand any fraud-caused negative entry to the File Fixer case-builder.

4. FILE FIXER MODULE. ACCESS_ART15 Datenkopie to Schufa/CRIF/infoscore → OCR sandbox → normalised credit
   file (reuse the provenance parse pipeline). Then: error-hunting disputes (Klärungsfall), retention
   enforcement (encode the Code-of-Conduct schedule + a BGH case-by-case deletion-argument builder),
   inquiry hygiene (Konditions- vs Kreditanfrage). NEVER generate a promised-score claim (docs/05).

5. USABILITY — LAUNCH GATE (before onboarding real users), AFTER THE WORKING FUNCTIONAL CORE. Do not
   block the first working provenance request on this; once steps 1–4 work end-to-end with a plain UI, this
   is mandatory before real users touch the product. The product must be usable by ANY German adult,
   including low German literacy, low digital confidence, or no idea what a credit bureau is. The measure
   of success is that such a user understands the risk, the benefit, and their next action from VISUAL
   CUES AND GUIDED FLOWS — not from a written tutorial. For each module, produce:
   (a) a user-action-flow diagram (states, decisions, and what the user SEES at each step), and
   (b) reusable visual components: a data-flow map (broker → bureau → lender), a red/amber/green
       file-health dial, and a request pipeline that renders Gesendet → Frist läuft → Antwort → Erledigt
       with the statutory deadline as a live countdown.
   Enforce these rules in every user-facing screen: show a picture before words; ONE decision per screen
   with a plain-language question and a clear default (e.g. "Möchten Sie diese Firma auffordern, Ihre Daten
   zu löschen?"), never a multi-field form; default German at ~B1 reading level with a Leichte Sprache
   toggle and a one-tap plain explainer on every legal term (Bonität, Auskunftei, Widerspruch, Score);
   WCAG 2.2 AA, full screen-reader support, large-text/high-contrast, and one-handed use on a mid-range
   Android. Add an automated accessibility check (axe-core) to CI, and add to every feature's definition of
   done: "every screen states the next action; no dead ends; passes the a11y check; readable at B1."

Do NOT build this session: the browser Copilot/extension (Phase 2 acquisition surface); the public
provenance/compliance scoreboard (Phase 2, facts-only, counsel-reviewed); L2 browser agents; the canary
attribution graph (issuance only). Do NOT claim scraping defence affects a Schufa score. Keep every
guardrail from CLAUDE.md and docs/06 (identity binding, untrusted-document sandbox, no third-party
credential storage, no false data submitted to controllers).

Work in small reviewed steps. Write tests as guardrails: a provenance follow-up must not auto-send an
Art. 77 complaint; a request whose subject is not the verified identity must be unrepresentable; a screen
with no stated next action should fail a lint/DoD check. When done, update ARCHITECTURE-DECISIONS.md and
give me (a) the module-by-module success-rate model your telemetry now makes measurable, (b) the set of UX
flow diagrams and visual components you built, and (c) anything a human must verify (bureau endpoints,
counsel sign-off on templates, DPA venues).

Start by showing me the Prisma deltas and then a WORKING ACCESS_ART15_SOURCE path end to end (request →
send → parse reply in the sandbox → ProvenanceEntry rows → broker match → drafted follow-ups), with a
minimal plain UI, for review before the other modules. Defer the UX flow diagrams and visual components to
step 5 — do not build them before the working request.
```

## Why these features are the "high success rate" ones
Provenance and File Fixer are statutory paperwork with the law on the consumer's side and a proven
enforcement pattern (Austria DSB, BayLDA, noyb). The success barrier has been distribution and bureaucracy,
not legality — so automating the paperwork and making it usable by anyone is the win. Fraud Shield attaches
to a concrete, high-salience fear (~€10bn/yr) with a remedy 91% of victims never use. All three avoid the
one claim the research disproved (scraping → score).
