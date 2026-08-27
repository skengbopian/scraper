# SCRAPER4-DECISION — kill the build, run the campaign

**Date:** 2026-08-26 · **Derived from:** an 8-agent pass (2 repo readers, 3 web researchers with
2026-dated citations, 1 MVP architect, 2 adversaries). The architect said PROCEED-re-specified; the
kill advocate said **KILL**; the schedule skeptic said **ONLY-IF** at roughly 2× the claimed effort.
Weighing all three: **kill the Scraper 4 build. Run the campaign it would have automated — this
week, manually, using assets the repo already contains.** This document records why, gives the
manual runbook, and preserves the conditional build plan in case the campaign produces evidence
that reopens it.

## 1. The premise correction (this alone re-aims the pivot)

**Workday does not webscrape, and cannot be a direct target.** ATS/HCM vendors (Workday,
SuccessFactors, Greenhouse, Personio) are GDPR **processors** — a DSAR sent to them is a ~100 %
redirect to the employer, who is the controller. Workday's AI (HiredScore acquisition, Illuminate)
runs on tenant data, not scraped web data. The Workday-shaped pain that IS actionable is
event-driven and tiny: an Art. 15/17 letter to a specific **employer** you actually applied to,
plus the German ~6-month rejected-applicant retention rule — which is already pure code in this
repo (`assessApplicantRetention()`, ADR-025).

The real controllers of scraped workforce data are: B2B enrichment brokers (ZoomInfo, Apollo,
Lusha, Cognism, People Data Labs, RocketReach, Kaspr, Dealfront), talent-intelligence/sourcing
databases (SeekOut, hireEZ, Eightfold, Revelio-class), and web-data vendors (Coresignal,
Bright Data). **Six of these already have shipped, tested playbooks and self-serve routes verified
2026-08-09 in this repo** (`playbooks/loeschung.*.yaml`,
`packages/core/src/leverage/broker-routes.seed.ts`).

## 2. Why the build dies (the honest arithmetic)

- **The workload doesn't justify a tool.** Total in-scope campaign: ~13–30 requests, sent once,
  plus a ~6-month recheck cycle. The wave-1 six all have working self-serve opt-out forms
  (~10 min each, processed in 1–7 days). EU-established targets are covered by the
  Datenanfragen.de generator — the exact CC0 corpus the build would have vendored as its template
  source. The whole campaign is **1–2 afternoons with a browser and a spreadsheet**, producing the
  same suppression outcome and the same DPA-filable paper trail (a self-represented Art. 77
  complaint needs an email copy and the controller's reply, not a hash chain).
- **"A few weeks" was not a few weeks.** The skeptic's file-level audit: realistic effort
  ≈ **32–40 part-time days** (~2× the design's estimate), and controller-reply latency pushes the
  acceptance gate to calendar week 9–10 regardless of effort. With aggressive scope cuts it
  compresses to ~18–24 part-time days ≈ 4–6 part-time weeks — the generous end of "a few weeks",
  for a tool whose addressable workload is two afternoons. Specific unpriced items: `SELF_ATTESTED`
  does not exist in core (3–7 days or a documented label decision), core tests are repo-root-coupled
  (fixture slice must be vendored), **no English templates and no Art. 77 prose exist** (2–3 days
  of drafting reviewed by nobody), fresh-domain DKIM deliverability risk feeds the kill metric with
  spam-folder artifacts.
- **The durable value needs zero code.** Reappearance of opted-out profiles on ZoomInfo-class
  platforms runs >65 % within 12 months — suppression is a treadmill. The one intervention with
  durable effect is choking the re-scrape source: the LinkedIn/XING hardening checklists, which
  already exist as guided routes in `source-hardening.seed.ts`.
- **The kill criteria were answerable for €0 before building.** "Do ≥2 targets even hold my data?"
  is an hour of self-lookup. "Do the channels respond?" is answered by filing the six free
  opt-outs and starting the same 6-week clock — no repo required. Kill criteria that can only fire
  after the build cost is sunk are permission slips, not criteria.
- **The legal ammunition attaches to the letter, not the tooling.** Garante–Lusha €2M (2026-07-27,
  Art. 3(2) applies to a no-EU-establishment broker), CNIL–Kaspr €240k (2024-12-05), ICO–Clearview
  [2025] UKUT 319 (broad "monitoring"), VDAI–Whitebridge (individual complaint → compliance order
  in ~8 months). A generated letter with the citation paragraph pasted in carries identical force.
  Honesty rider: against pure-US firms with no EU footprint (SeekOut/Revelio-class), the GDPR
  letter is leverage and paper trail only — Clearview has paid €0 of €100M+ in fines.

## 3. The week-0 campaign (the actual MVP — run this instead)

0. **Self-lookup (~1 hour).** Search yourself on ZoomInfo, Apollo, RocketReach, Lusha. Fewer than
   2 holders → you're done; the pivot sunsets as "not needed" (success and kill are
   indistinguishable here).
1. **Source hardening first (durable, ~15 min).** Execute the LinkedIn + XING checklists from
   `packages/core/src/leverage/source-hardening.seed.ts` in your own session. This throttles the
   refill; everything after it decays slower.
2. **Wave-1 self-serve opt-outs (~1 hour).** The six verified routes in
   `broker-routes.seed.ts` — ZoomInfo, Apollo, Lusha, Cognism, People Data Labs, RocketReach.
   ~10 min each, own browser, screenshot every confirmation, note the date.
3. **EU-established targets by letter (~1 hour).** Dealfront, Kaspr, Cognism (UK), Coresignal —
   Datenanfragen.de generator, Art. 17(1)(d) i.V.m. Art. 21(1), paste the precedent block from §2.
   (The repo's own `art17-datenhaendler.de.md` is the German-language equivalent if preferred.)
4. **Track in a spreadsheet.** Columns: target, channel, sent date, ack date, reply,
   classification (complied/incomplete/refused/silent), evidence file, recheck due (~6 months —
   calendar reminders). This is the entire "state machine" a 30-row personal campaign needs.
5. **Escalate on refusal or an incomplete answer** (the reply itself proves receipt): free-form
   Art. 77 complaint at your residence-Land DPA, attaching your email copy and their reply.
   Class-C silence (pure-US) is expected — log it, don't chase it.
6. **Event-driven singles, only when triggered:** actually screened by HireRight / assessed by
   HireVue / applied via an employer's ATS → one letter from the existing repo templates
   (`art15-17-screening.de.md`, `art15h-22-3.de.md`, employer-addressed Art. 15/17 with the
   6-month retention rule).

Guardrails carry over verbatim even manually: your own data only, no false statements, no
CAPTCHA-solving services, no credential sharing, never assert a statutory deadline you cannot
prove started.

## 4. Reopen criteria — what evidence would justify building after all

Reopen the build **only if the campaign itself demonstrates all three**: (a) ≥2 confirmed holders
with successful initial suppression, (b) reappearance churn across ≥2 recheck cycles that
calendar reminders demonstrably fail to manage, and (c) an expected multi-year horizon of
recurring cycles. If reopened, the design-of-record is preserved from this pass: a **new thin repo
importing `packages/core` vendored verbatim at a recorded SHA** (core is genuinely pure — sole dep
`yaml`, 5,271 src LOC + full test suite), with the schedule skeptic's five conditions adopted as
scope law: (1) identity as a documented D11-style label decision, not a core tier;
(2) the root-fixture manifest vendored on day 1 (schema/, docs/05, docs/08, templates/ +
.signoff.json, playbooks/, two frozen api files); (3) wave-1 six only; (4) portal confirmations
count as replies at the acceptance gate; (5) prose capped at one English erasure/objection letter
+ one German Art. 77 draft, owner-review recorded as a deliberately lowered bar. Realistic budget
then: 18–24 part-time days. An owner-signoff tier must never occupy a manifest field named
`counsel`.

## 5. What flows back into Scraper 3 regardless (it comes from the campaign, not code)

- Refreshed verification stamps for the six broker routes (current stamps: 2026-08-09) and new
  census rows (Dealfront, Kaspr, Coresignal, SignalHire, ContactOut, Wiza, Bright Data/EDPO) in
  the `docs/07-controllers-seed.md` format.
- The 2026 precedent citation block as a counsel-reviewable `templates/` fragment (also the missing
  Art. 77 prose gap PLAN-INDEPENDENT names).
- Outcome telemetry: response times, dead-end rates per class, reappearance intervals — calibrates
  `deadlineDays`, the recheck cadence, and PLAN-INDEPENDENT's answered-vs-silence assumptions.

## 6. Adversarial findings preserved (abridged)

**Kill advocate (verdict KILL):** no payback at n≈30 (manual dominates); the motivating example
died in research and the plan survived by silently swapping the problem; the durable slice
(source hardening) needs no engineering; the "safety travels as structure" claim overstates —
on a private single-owner repo it travels as discipline; kill criteria sequenced after sunk cost.
**Schedule skeptic (verdict ONLY-IF):** realistic 32–40 part-time days vs 15–17 claimed;
`SELF_ATTESTED` unbuilt in core and on the critical path; core tests root-coupled; the activation
gate has no non-counsel path (an owner signature in a `counsel` field would be dishonest labeling);
no English/Art. 77 prose exists; reply latency decouples calendar gates from effort gates; DKIM
deliverability can masquerade as mechanism failure. Full agent outputs: session transcript
2026-08-26 (workflow `wf_ac5f9593-708`).
