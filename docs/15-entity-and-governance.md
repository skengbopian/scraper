# 15 — Entity, licence, funding and governance

**Status: every decision in this file is OPEN.** Nothing here has been decided by the product owner,
and no coding agent may decide any of it.

`docs/14-decentralised-deployment.md` records half of the 2026-08-14/15 pivot: Scraper launches as
software EU citizens run themselves, not as a centrally-operated business. This file records the
other half, which until now was written down nowhere. Before it existed, the word "non-profit"
appeared in exactly one place in this repository — the sentence in `docs/14` §1 describing a *Verein*
as one possible posture-B operator — while the operating model it implies (no entity, no revenue, no
governance, no licence) governed everything from the counsel brief to whether the software may
lawfully be distributed at all.

## 1. The one thing to get straight first

**Entity, licence and funding gate PUBLIC RELEASE. They do not gate the first send.**

The first real request (PLAN §2) is one identity-verified person — realistically the product owner,
on their own posture-A node — sending one Art. 21(2) objection about their own data. That act needs
no company, no licence and no money to move. It needs counsel sign-off on a template, a verified
identity, and a working node.

Publishing the software to other people is a different act, and it is the one this file gates.
Sequencing them apart is worth roughly two months (decision D2) and is the single largest schedule
lever in the plan. Do not let a licence question block a letter, and do not let a working letter
imply the licence question is closed.

## 2. The decision register

Seeded from `PLAN-OPERATIONAL.md` §3. **Owner-only.** Record answers by editing the Status column in
place and dating it; do not delete the recommendation, so the reasoning survives the decision.

| # | Question | Recommendation (not a decision) | Blocks | Status |
|---|---|---|---|---|
| **D1** | Which identity artefact does posture A use? | German eID / AusweisIDent (§18 PAuswG) — the only route an individual can procure; POSTIDENT and IDnow are B2B and need a legal entity | The identity + mandate surfaces, i.e. the production path to `VERIFIED`. Longest procurement lead after counsel | **OPEN** |
| **D2** | Entity now, or posture A as a natural person first? | (b) — first send as a natural person. An entity blocks public release, posture B and any money movement; it does not block the first letter | Licence licensor, Impressum, DPIA controller, AVVs, the RDG §6/§7 route | **OPEN** |
| **D3** | Licence | AGPL-3.0 for the application; CC0 or CC-BY for `playbooks/` and `templates/`; a THIRD-PARTY-NOTICES file, and the Datenanfragen CC0 attribution the census owes | **Any public release. See §3 — this is the hard blocker** | **OPEN** |
| **D4** | Does money ever move, including Verein dues? | Never, or donations only. Strike or supersede the €5–10/mo statements in `docs/01` before counsel is instructed | The RDG instruction scope, the §52 AO category if a Verein is ever formed, the entire consumer-contract workstream | **OPEN** |
| **D5** | Which letter is sent first? | `werbewiderspruch.az-direct` by email, provisional clock — the only playbook with no blocking open question, and `identityProof.required: false` sidesteps the unbuilt IdentityPacket | The scope and cost of the first counsel instruction | **OPEN** |
| **D6** | QTSP account | Ship the degraded-but-honest mode as the default (both paths are built and tested); procure an account only for the node you personally run | The postal workstream's shape, the UI's clock copy, and whether Art. 77-on-silence is in scope at all | **OPEN** |
| **D7** | Mandate form on posture A | A recorded in-app confirmation plus an evidence hash (`docs/14` already argues this); a QES per self-hoster is not procurable | The mandate route | **OPEN** |
| **D8** | Backup retention window | 7 days, as a compose environment variable; the KEK on separate media, never beside the database dump | DPIA sign-off, the erasure-confirmation copy, the operator guide | **OPEN** |
| **D9** | `apps/web` prototype | Keep briefly as the design source for the dial, data-flow map and countdown; port to `web-next`, point the a11y gate at `web-next`, then delete | Which artefact the usability gate actually measures; packaging | **OPEN** |

## 3. No LICENSE file exists, and that is a blocker

There is no `LICENSE`, no `COPYING`, and no licence header anywhere in the tree. Under default
copyright that means **nobody but the author has permission to run, copy or modify this software** —
which makes the entire launch model ("EU citizens self-host it") unlawful to distribute as the repo
stands today. It costs one file to fix and it cannot be fixed by inference: silence is not
permissive.

Three surfaces need answers, and they are not the same answer:

- **The application** (`apps/`, `packages/`, `services/`, `tools/`). D3 recommends AGPL-3.0: a
  network-copyleft licence keeps a posture-C operator's modifications available to the people whose
  rights the node exercises, which is the same interest the pivot is built around.
- **The corpus** (`playbooks/`, `templates/`, the census). This is a commons and `docs/14` §6 already
  says so. A permissive or public-domain dedication serves that better than copyleft — and the
  census carries a CC0 attribution obligation to Datenanfragen.de that must be honoured explicitly.
  Note the tension with the template seal: a CC0 template is freely forkable, and a fork's letter
  carries no counsel signature. That is OQ-30's territory, not a licensing footnote.
- **Third-party notices.** Assembled from the dependency tree; not a decision, but not automatic
  either.

`TODO(counsel):` a licence is a legal instrument. D3 records an engineering preference, not advice.

## 4. Governance — undecided, and it needs to be decided before the second node exists

The moment anyone other than the owner runs this software, four questions become real, and none has
an answer today:

- **Who may change the corpus?** A playbook edit changes what letters real people send to real
  companies. `playbooks/.shipped.json` and `templates/.signoff.json` make a change *detectable* and
  bind a signature to prose; neither says who is allowed to make one.
- **What does "counsel-signed" mean downstream?** A signature obtained here covers wording, not the
  circumstances of a node we never see. This is OQ-30 and it is the question most likely to be
  answered badly by default — silence reads as a warranty.
- **Who answers a security report?** The repo root carries no security-disclosure policy and no
  contact address. A finding in software running on strangers' machines, holding identity documents
  and credit data, currently has nowhere to go. (Named without a filename on purpose: spec-audit's
  doc-reference check would read a backticked path as a claim that the file exists.)
- **Who can say "stop"?** If a playbook turns out to send a legally wrong letter, there is no update
  channel, no revocation mechanism, and — by design (`docs/14` §3, no phone-home) — no way to know
  which nodes are running it. The corpus is versioned and sealed; the *deployed* corpus is not
  reachable. That is a deliberate consequence of decentralisation, not an oversight, and the honest
  mitigation is that a node's operator must have deliberately activated the playbook in the first
  place.

## 5. What this file does not do

It does not choose. Every row in §2 is the owner's, and the recommendations exist so that a decision
is a confirmation or a correction rather than a fresh analysis. It also does not restate `docs/14`:
postures, what decentralisation simplifies, and what it weakens live there.
