# 00 — Overview: what we are building and why

## The thesis in three sentences

Europe has the strongest data-deletion rights in the world and almost no infrastructure to exercise
them (noyb measured 83.5% of GDPR access requests answered improperly or not at all). Germany is the
most underserved major market: the only scaled automated competitor (Incogni) is generic, the main
free German tool (Selbstauskunft.net) shut down, and the German problem is structurally different from
the US one — the adversaries are **credit bureaus, address traders, directories and ad-tech**, not
US-style people-search sites. Scraper industrialises legally-precise German rights requests, proves the
results, escalates non-compliance to regulators, and links data hygiene to the outcome Germans care
about most: the **Schufa score**.

## The five product modules (full product; Phase 0 builds only part)

1. **Data Radar** — see who holds your data (intake, breach presence, proactive Art. 15 access sweeps,
   OCR+LLM parsing of postal responses into a normalised map).
2. **Receipts** — prove who leaked/sold it (per-service canary aliases/numbers, attribution graph,
   evidence packs, a facts-only "leaky companies" scoreboard). *Deferred past Phase 0.*
3. **Erasure Machine** — automated removal with teeth (an automation ladder L0–L4 ending in Art. 77
   DPA complaints). **Phase 0 builds the L0/L1 + escalation core.**
4. **Copilot** — a browser extension that grades sites A–F, emits GPC, auto-rejects cookie banners,
   and intercepts signups with aliases. *Deferred past Phase 0.*
5. **Score Studio** — Schufa/CRIF/Boniversum error-hunting, retention-rule disputes, and a simulator of
   the new 12-criteria Schufa score. **Phase 0 builds only the single Datenkopie request.**

## Why now (the regulatory window)

- **CJEU C-634/21 (Dec 2023):** Schufa scoring is an "automated decision" — direct rights against the bureau.
- **CJEU C-203/22 (Feb 2025):** controllers must explain the procedure and principles *actually applied*.
- **BGH (Dec 2025):** no blanket deletion of settled defaults, but **case-by-case balancing** — a lane for
  individualised deletion arguments.
- **New Schufa score (2025–2028 rollout):** 12 published criteria with weights — transparency is being
  commoditised, shifting value to error-hunting and disputes.
- **EDPB 2025:** right to erasure is the coordinated-enforcement theme.
- **California DROP (binding 1 Aug 2026):** proves centralised deletion works; the EU has no equivalent —
  Scraper's one-liner is "the DROP Europe never built."
- **Risk to respect:** the **Digital Omnibus** (Nov 2025) may let controllers refuse "commercial" or
  "excessive" access requests — so lead with Art. 21(2) objection, keep every request individualised.

## International (post-Germany, for context only — not Phase 0)

Leverage-first order: **DACH (AT/CH)** → **UK** (Companies House address suppression + legacy
electoral-roll cleanup) and **Sweden** (post-*Lexbase* C-199/24 söktjänst cleanup, BankID) → **Quebec**
(Law 25 s.28.1, French-language moat that blocks Optery) → **Japan** (biggest whitespace, gated on the
非弁 unauthorised-practice rule → user-initiated software + law-firm partner). Skip for now: New Zealand,
South Korea, Finland/Denmark/Norway.

## What "good" looks like (targets the build serves)

- Verified removal/response >60% at 90 days (vs incumbents' measured 35% at 4 months).
- Time to first visible result <7 days.
- Blended cost per completed action <€0.50 digital / <€1.50 postal-heavy.
- >80% of actions fully automated (deterministic playbooks), agents ~15%, humans <5%.
- DSAR satisfactory-response rate >60% *with escalation* (vs noyb's 16.5% baseline).

Full detail: the market report `Scraper_Right_to_Be_Forgotten_Report.docx`.
