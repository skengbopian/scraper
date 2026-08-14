# 11 — Datenschutz-Folgenabschätzung (DPIA) — DRAFT for counsel

> **Imported from the pre-audit line** (`~/Downloads/scraper`, commit `cc9dcb4`) in port wave 1,
> per ADR-030. Checked on import: this document makes **no claim about the request state machine or
> the statutory clock** — it is scoped to the leverage ladder (A's ADR D23) — so nothing in it
> contradicts ADR-012's provable-clock model. Two references point at files that arrive in later
> waves: `scripts/readiness.mjs` (wave 1) and A's `domain/policy` core module, whose equivalent
> logic in this line lives under `packages/core/src/leverage/`. **[COUNSEL]** markers are the
> author's, and this remains a DRAFT — see `docs/counsel-review-packet.md` §5 for how it enters the
> counsel queue. When the legal-request pipeline becomes launchable, this DPIA needs the amendment
> its own scope note anticipates, and that amendment MUST describe the 16-state model, not A's.

**Status: DRAFT. Not signed. Not a legal opinion.**

This is written so a qualified German data-protection lawyer can *correct* it
rather than start it. Everything an engineer can state as fact about the system
is stated as fact and is traceable to code. Everything that is a legal
judgement is marked **[COUNSEL]** and left open — including whether this
assessment is adequate at all.

**Scope: the leverage ladder only** (ADR D23). Art. 6(1) DSGVO obliges an
assessment of processing that *exists*; the legal-request pipeline, credit-file
handling and hostile-document parsing are not launchable (see `pnpm readiness`)
and are deferred to an amendment. Amending a DPIA as processing expands is
routine; describing hypothetical processing is not useful to anyone.

- Controller: **per deployment posture** — see the note below. (The original draft assumed a
  central Scraper entity, **[COUNSEL]** GmbH/UG; that is no longer the launch plan.)
- DPO: **[COUNSEL]** — per operating entity. See §9.
- Version 0.2 · 2026-08-14 · owner: project + counsel jointly

> **Deployment postures (2026-08-14 pivot — normative record in `docs/14-decentralised-deployment.md`):**
> the launch plan is a **decentralised service**. Posture **A** is a data subject self-hosting to
> exercise their own rights; posture **B** is a node operated for others; posture **C** is a hosted
> central instance (the original assumption, retained as written but no longer the plan). This DPIA
> **binds whoever operates a posture-B or posture-C node** — each such operator is the controller for
> their node and owes their own assessment, for which this document is the template. Whether posture A
> is regulated processing at all is Art. 2(2)(c) territory and is deliberately left to counsel
> (OQ-23); for posture A this document serves as engineering documentation of what the software does,
> which is worth having regardless of the legal answer.

---

## 1. Is a DPIA required?

Yes, and it is not a close call. Art. 35(3) DSGVO triggers plus the German
supervisory authorities' *Muss-Liste*:

- **Systematic and extensive evaluation** — we hold a map of which companies
  process a person's data and what they were asked to stop.
- **Data revealing vulnerability** — the users most motivated to use this are
  disproportionately people escaping harassment, debt collection or an abusive
  ex. That is the population the anti-stalker rule (docs/06 C1) exists for.
- **Innovative use** — an automated rights-exercise agent has no settled
  practice to fall back on.

Even where a single trigger might be arguable, the combination is not.

## 2. What the ladder actually does

Four things, of which only the first two touch a third party at all.

| Tier | Operation | Personal data used | Leaves our systems? |
|---|---|---|---|
| 0 | Issue an email alias on a Scraper domain; forward inbound mail; burn on request | Account email; generated alias | Alias address, given by the USER to a company of their choosing |
| 1a | Deep-link the user to a company's own deletion/preferences page with a checklist; record what they report | Verified name/DOB/address, shown only to the user | **No** — the user acts; we transmit nothing |
| 1b | Enrol in a voluntary industry suppression programme | Verified name + address (server-submitted programmes only) | Yes, to the programme operator |
| — | Record every action in a telemetry ledger | User id, tier, mechanism, cost, outcome | No |

**What is NOT in scope of this version:** statutory rights requests, credit
files, controller-response parsing, evidence chains, Art. 77 complaints. None
are reachable — every controller and playbook ships `active = false` and the
dispatch guard refuses inactive rows.

## 3. Necessity and proportionality

The doctrine is itself the proportionality argument, so it is worth stating
plainly: **the product is built to prefer the least-invasive instrument that
achieves the outcome.**

- A Tier-0 alias means the data is never created — no processing beats minimised
  processing.
- A Tier-1a handoff transmits **nothing**. The user's verified details are shown
  to the user, never sent by us.
- The router refuses to generate a statutory request when a cheaper rung
  achieves the same outcome, and records the decision as evidence rather than as
  a log line: `packages/core/src/leverage/routing.ts` returns the chosen tier
  plus a `routingDecision` audit object, which
  `apps/api/src/requests/prisma-requests.repository.ts` persists to
  `LeverageAction.routingDecision` (migration 0009). Tested in
  `packages/core/test/routing.test.ts` and `packages/core/test/ladder.test.ts`.
  *(This bullet previously cited two files under a "protection-router" name —
  a repository and an integration test. Neither has ever existed in this repo;
  they are names carried over from the pre-audit line. The control is real, the
  citation was not, and in a document a regulator reads as evidence that is the
  worse of the two failures. The names are deliberately not repeated in code
  formatting here, so the spec-audit reference check does not go looking for
  them again.)*
- The identity packet sends the *minimum* proof a controller accepts, never the
  maximum. The refusal is enforced at render time in
  `packages/core/src/playbook/engine.ts`, which will not render a letter claiming
  an enclosed identity proof unless a packet was genuinely attached to *that*
  dispatch (`attachedIdentityPacketId`), and the playbook's `identityProof`
  block is what decides whether one is required at all — an unconditional
  Art. 21(2) marketing objection does not set it.
  **[COUNSEL]** the packet GENERATOR (deciding which fields a given controller
  may see, and redacting the rest) is specified in `docs/03` and is not yet
  built; today a packet is attached or it is not. Do not describe field-level
  minimisation within the packet as an implemented control.

**[COUNSEL]** Lawful basis per operation. Working assumption: Art. 6(1)(b)
performance of the contract for Tiers 0/1a/1b, since the user asked for exactly
this service; Art. 6(1)(f) legitimate interest for the telemetry ledger, with
the balancing test at §7. Confirm both.

## 4. Data flows and recipients

**Rewritten 2026-08-14 for the decentralised launch posture.** The original section named one
operator's stack as fact; under the pivot every infrastructure choice below is made **per node, by
that node's operator**, and the recipients analysis is theirs to instantiate. What this section can
state as fact is what the *software* does and does not send — those claims are traceable to code and
hold on every node.

### What the software itself guarantees about flows

- **Nothing phones home.** The only network egress is through the provider interfaces
  (`packages/core/src/providers/index.ts`): mailer, postal provider, timestamper (QTSP), ident
  provider, model provider — all stubbed until an operator configures real ones. The controller
  census ships as static data in the repo; playbooks and templates ship in the repo; compliance
  statistics stay in the node's own database. There is no central telemetry, no update push channel,
  no install registry, and **no cross-node flow of any kind** — no aggregation of outcomes, no shared
  subject data, no federation protocol. If any of that is ever built it is a new processing activity
  requiring its own assessment first (OQ-25).
- **No US-region inference on personal data.** The model provider is an interface whose region
  defaults to `eu` (docs/06 M11), and the ladder invokes no model at all.
- **EU residency is a per-node duty the defaults push toward**: the boot gates refuse unset
  KEK/CORS postures outside dev, `MODEL_REGION` defaults to `eu`, and the deployment guide must state
  what software cannot enforce — where the operator hosts.

### Recipients, per node

Each is chosen and contracted by the node operator; on posture B/C each needs that operator's own
Art. 28 arrangement. On posture A most are optional — the manual delivery-proof route means a
self-hoster can run with **no** postal or QTSP vendor at all (post at a branch, record the paper
receipt; the clock then still requires a QTSP anchor and honestly refuses without one).

| Recipient | Sees | When |
|---|---|---|
| Mail provider (reference: an EU transactional-mail service) | outbound request letters; inbound replies; for the alias relay, sender↔alias pairings (R3) | if email channel configured |
| Postal / hybrid-mail provider | letter contents incl. subject identity | if postal channel automated |
| QTSP (qualified timestamper) | **hashes only** — the anchor covers a chain hash, never content | if statutory clocks are wanted |
| Ident provider (eID/POSTIDENT) | identity attributes it verifies | at verification |
| Suppression programme operators (DDV) | name + address | server-submitted enrolments only |
| Companies the user gives an alias to | the alias address | the user's own choice, not a system flow |
| The controllers themselves | the letters — subject identity as the request requires | every send; this is the product working |

**Reference deployment (what a posture-C operator was going to run, kept for whoever runs one):**
Scaleway `fr-par` hosting (EU-owned, no US parent, no Chapter V transfer to argue), Scaleway TEM for
mail, Scaleway KMS holding the KEK. **[COUNSEL]** for any operated node: that operator's sub-processor
list and Art. 28 DPAs reviewed and filed; the mail relay remains the sensitive one — it necessarily
sees who contacts a user at their alias, whichever vendor it is.

## 5. Risks to data subjects, and what actually mitigates each

Written as risk → control → where the control is enforced. Controls in **bold**
are enforced by the database or the type system, not by convention — an
engineer cannot forget them.

### R1 — The product becomes a way to find or harass someone (CRITICAL)
The founding risk (CLAUDE.md, docs/06 C1). Someone uses Scraper to act on
*another person's* data and learns where they live.

- **Subject identifiers are derived from the verified `Identity` record and are
  free-typed nowhere.** No API accepts a subject.
- **Composite foreign keys make cross-user binding unrepresentable at the
  database** — `(identityId, userId) → Identity(id, userId)` and friends.
- **A server-submitted suppression enrolment is identity-gated**, because it
  asserts a real name and address to a registry on someone's behalf.
- **Contact identifiers require proven control** — a Scraper alias, the account
  email, or a challenge completed *at* the address. An unproven identifier
  cannot reach a controller's form: the payload builder accepts only a branded
  type obtainable from one checked function.
- Guided handoffs transmit nothing at all, so the question does not arise.
- Lookup rate limiting and an anomaly-review queue (docs/06 C1).

**Residual risk: LOW *within a node, against its users* — and structurally so rather than
procedurally.** The 2026-08-14 pivot moves the trust anchor: each node runs the identity gate on
infrastructure its own operator controls, so these controls bind a node's users and **cannot bind the
node's operator**. That risk is not this row — it is R8, stated on its own rather than blended in to
keep this row's LOW honest for what it still covers.

### R2 — Account takeover exposes the map (CRITICAL)
One account shows which companies hold a person's data and what they asked to
stop. For the vulnerable-user population that is a targeting aid.

- **Mandatory MFA, non-bypassable by construction**: the password opens a
  session authorised for nothing until the second factor lands (ADR D20).
- **Short-lived step-up** gates every read that decrypts, including the alias
  list — because alias→person is a re-identification surface.
- Server-side revocable sessions with an idle timeout; instant "sign out
  everywhere".
- Per-user envelope encryption; only wrapped DEKs leave the KMS. **IMPLEMENTATION STATUS
  (2026-08-13 audit): the envelope machinery is live but applied only to the TOTP secret; the KMS
  is an env-var resolver. See §6 for what this means for the identity row.**
- Account-scoped login throttling and no enumeration oracle on any auth path. *(Was overstated:
  `POST /auth/register` answered EMAIL_TAKEN until the 2026-08-13 audit; it now returns an
  indistinguishable decoy for taken addresses, so the sentence is true again.)*

**Residual risk: LOW–MEDIUM.** Medium because credential stuffing against a
consumer product is a permanent condition, not a solved problem.

### R3 — The alias relay becomes a surveillance dossier (HIGH)
Forwarding mail means seeing who contacts each user — the exact "who is in
this person's life" map the product exists to prevent others building.

- The relay **logs neither sender nor alias**; there is a test asserting it.
- The idempotency ledger stores *only* the provider's opaque message id — no
  sender, no subject, no alias.
- No content parsing, no attribution graph, no spam analysis. We move the
  envelope; we do not read the letter.
- Burned/unknown aliases **drop silently rather than bounce** — a bounce tells
  a sender they found a live person trying to get away from them.

**Residual risk: MEDIUM.** Scaleway TEM can see the sender/alias pairing even
though we do not record it. **[COUNSEL]** Whether that requires disclosure in
the privacy notice beyond naming the sub-processor.

### R4 — We tell someone they are protected when they are not (HIGH)
A user relies on a "done" that is not real and stops taking their own
precautions. For this population that is a safety risk, not just a UX failure.

- Verification strength is **never blended**: self-reported success is a
  separate bucket in both the ledger and the UI.
- Cookie-scoped opt-outs (DAA/YOC/NAI) are **structurally guided-only** — a
  database CHECK forbids claiming we set them — with a realistic 6-month term,
  and the renewal sweep marks them *lapsed* rather than auto-renewing.
- Stale or unverified routes are **withheld**, not offered.
- The Robinsonliste is described as voluntary, binding only its members.

**Residual risk: LOW**, provided the copy review (§10) holds the line.

### R5 — The staleness fetcher is turned against someone (MEDIUM)
Our servers fetch operator-supplied URLs — a textbook SSRF primitive.

- https-only; every resolved IP checked against private/loopback/link-local at
  **connect time** (a pre-flight resolve is defeated by DNS rebinding); every
  redirect hop re-validated; no cookies or identifying headers; time and size
  caps.

**Residual risk: LOW.**

### R6 — Erasure is not really erasure (MEDIUM)
Art. 17 is implemented as crypto-shred: null the DEK. **A backup that retains
old wrapped DEKs silently resurrects every "erased" user's key.**

- **[COUNSEL] + [OPS] OPEN.** Backup retention must be set so no snapshot
  outlives the shred, and the policy must be written down here before launch.
  This is the single most likely way to be non-compliant while believing
  otherwise.
- Telemetry rows (`LeverageAction`) are deliberately **retained** through
  erasure so the metric keeps its denominator. They carry no subject fields.
  **[COUNSEL]** Lawful basis — Art. 89 statistical purposes vs. Art. 6(1)(f) —
  and whether `userId` should be pseudonymised at shred time.

**Residual risk: PARTLY RESOLVED (2026-08-14), and the remainder is the backup
question.** The mechanism now exists: the DOSSIER key is destroyed on erasure and
the dossier is unreadable from that moment (§6). What is NOT resolved is that a
backup taken before the shred still contains the key, so the erasure completes
only when that backup expires — and that is an operations decision, not an
engineering one. **[OPS]** set and state a short backup retention, and do not
confirm completion to the user earlier than it allows. Do not launch on the
backup half.

### R7 — Alias misuse damages the user (LOW–MEDIUM)
An alias used where a real identity is legally required (Art. 5(1)(d) accuracy)
could invalidate a contract or a claim.

- **The prohibited contexts do not exist in the enum** — legal, financial,
  credit, insurance and government are not values a caller can pass.
- **A second, independent database gate** refuses an alias at a prohibited
  controller type whatever the app believes.
- The UI states plainly where aliases must not be used.

**Residual risk: LOW.**

### R8 — A node operator abuses their own node (decentralised postures) (MEDIUM)
New with the decentralised launch posture (`docs/14-decentralised-deployment.md` §4). A malicious
operator controls the database their node's identity gate reads, so they can seed a "verified"
identity for a person who never consented — the exact shape R1 exists to prevent, attempted from
above the controls rather than through them.

What actually limits it, stated without flattery:

- **The software contributes no lookup capability** — no cross-node queries, no shared subject
  registry, no people-search, no central aggregation of anyone's answers. A stalker who forks this
  repo gains a letter-formatting convenience they already had with a word processor. Keeping the
  product useless as a search tool *even to its own operator* is the load-bearing control, and it is
  a property of what the project refuses to build.
- **The forged act is unlawful independently of the tooling** — impersonating a data subject to a
  controller — and controllers run their own requester verification, which is why `IdentityPacket`
  exists at all.
- **Production posture refuses a stubbed identity gate** (the M2 boot guards). An operator can run
  dev posture or edit the code; open-source controls bind honest operators and raise effort for
  dishonest ones, and no more than that should ever be claimed.
- Anti-bulk architecture holds per node: one subject per account, rate caps, no sweep engine — the
  abuse does not scale through us.

**Residual risk: MEDIUM, and irreducible below that by software.** It cannot be LOW because no
program binds its own administrator. **[SAFETY]** OQ-26 (whether posture B demands a verified
operator identity before any playbook activation) is the one open design lever. **[COUNSEL]** whether
distribution of the software itself carries any duty here beyond the warnings already shipped.

## 6. Data minimisation and retention

### The mechanism: two keys per user, and what destroying one does

Identity fields and address lines are **sealed at rest under a per-user DOSSIER
key** (AES-256-GCM envelope; migrations 0016–0018, implemented 2026-08-14). The
subject snapshot carried in the append-only request ledger is sealed under a
separate **EVIDENCE key**. Art. 17 erasure destroys the first key and leaves the
second, and `DELETE /auth/account` performs it.

Deletion was never available and this is not a preference. `RequestEvent` and
`EvidenceRecord` are append-only by database trigger, so the erasure cascades the
schema declared could never fire — the promised endpoint was *unbuildable*, not
merely unbuilt. Those triggers must stay: an evidence chain that can be edited is
not evidence. Crypto-shred answers both — the payload becomes permanently
unreadable, the ledger survives, and `UserKey.shreddedAt` is itself the record
that the erasure happened and when.

**Why two keys and not one.** Art. 17(3)(e) preserves data needed to establish,
exercise or defend legal claims. This product sends legal letters in a user's
name; if a controller later disputes that a request was made, or made lawfully,
those artefacts are the only answer available. A single key shredded on erasure
would destroy that defence. So:

| Key | Seals | Lifetime |
|---|---|---|
| DOSSIER | `Identity.legalName`, `dateOfBirth`, `IdentityAddress` lines | Shredded **immediately** on Art. 17 erasure |
| EVIDENCE | the subject snapshot in `RequestEvent` (who a request was about) | Survives erasure to the limitation window, then shredded by a job |
| AUTH (`User.wrappedDek`) | the TOTP secret | Shredded on erasure; kept separate so a dossier compromise does not open the second factor |

The EVIDENCE window is **three years from the year-end of the erasure** (§ 195
with § 199(1) BGB). **[COUNSEL]** confirm that window, and whether any claim this
product could face carries a longer one. The mechanism is not counsel's question;
the number is.

### Custody under the decentralised posture

Every key in the table above is held **by the node** — `EnvKekResolver` with an operator-held KEK is
the posture-A reference; a KMS is posture-B/C hygiene. Consequently the Art. 15/17 duties this
section's retention rows serve are owed **by each node's operator** to that node's users; on posture
A the erasure endpoint remains meaningful even with one user (a stolen or handed-on machine holds a
dossier worth shredding), and the backup half of R6 becomes each operator's own discipline — a
self-hoster's backup retention IS their erasure completeness.

### The threat model — stated exactly, and no wider

**What this closes: a stolen database dump or backup.** Ciphertext without the
KEK is not personal data in any usable sense.

**What it does not close: a compromised application process.** Both the API and
the worker hold the DOSSIER key in memory while they work — the worker must,
because the request subject is derived at send time from the Identity row rather
than threaded through a queue, which is what makes the anti-stalker binding true
end to end. Nor does it close a compromised KEK. No control here should be
described to a supervisory authority as protecting against either.

**Backups are the honest gap.** A shred destroys the live key; a backup taken
before the shred still contains it, so erasure completes only when that backup
expires. **[OPS]** backup retention must therefore be short and stated, and the
erasure confirmation to the user must not claim completion earlier than the
retention window allows. See R6.

### Still in the clear, and named rather than implied

`CreditFileEntry.{reportedBy, label, amountCents, raw}` is **not yet sealed** —
that is pass 2 of this work. Until it lands, erasure DELETES those rows outright
(they carry no append-only trigger, so deletion is possible where it is not for
the ledger), which is a correct erasure by a cruder mechanism. The credit-file
store also still shares the main Postgres role; segregation is checklist box D6
and is not done.

| Data | Retention | Basis |
|---|---|---|
| Account email, password hash | Life of account; email → digest and credential deleted on erasure | Contract |
| Verified identity (**sealed under DOSSIER**) | Life of account; **crypto-shred on erasure** | Contract |
| Request subject snapshot (**sealed under EVIDENCE**) | Erasure + 3 years (§ 195 BGB), then shredded | Art. 17(3)(e) |
| Credit-file contents (**plaintext — pass 2**) | Life of account; **deleted** on erasure | Contract |
| TOTP secret (encrypted) | Life of account | Security (Art. 32) |
| Sessions | 12h absolute / 30min idle; purged after expiry | Security |
| Aliases | Until burned; burned rows retained as tombstones so the address is never reissued | Contract + safety |
| Relay idempotency ledger | **[OPS]** short window, set to the provider's retry horizon | Security |
| Handoffs / enrolments | Life of account | Contract |
| `LeverageAction` telemetry | **Retained through erasure** — see R6 | **[COUNSEL]** |

## 7. Legitimate-interest balancing — telemetry (Art. 6(1)(f))

- **Interest:** knowing verified outcomes per euro by tier is what keeps the
  product pointed at cheap effective help instead of expensive theatre.
- **Necessity:** the metric is meaningless without failures in the denominator,
  so incomplete records would defeat the purpose.
- **Impact:** rows hold a user id, a tier, a mechanism, a cost and an outcome.
  No subject fields, no free text, no third-party data.
- **Expectations:** a user would reasonably expect us to know which of *their
  own* actions worked.
- **Safeguards:** append-only cost entries; outcomes cannot be revised; a
  payload contract rejects personal-data-shaped keys.

**[COUNSEL]** Is this balance sound, particularly for retention past erasure?

## 8. Consultation

**[COUNSEL]** Whether Art. 36(1) prior consultation with the supervisory
authority is required. Working assumption: **not** required for the ladder,
because residual risks are low or low–medium after mitigation — *except* R6,
which must be resolved rather than accepted. If R6 cannot be resolved, this
assumption fails.

## 9. DPO

**Per operating entity.** Posture A has no entity to appoint one for (if OQ-23 lands where §preamble
suggests); every posture-B/C operator answers this for themselves.

**[COUNSEL]** Whether Art. 37(1)(b)/(c) or BDSG §38 obliges a designation for an operated node.

Engineering constraint, independent of the legal answer: the founder and the
CTO **cannot** hold the role — a DPO may not supervise processing decisions
they themselves make (Art. 38(6)). An external DPO on retainer is the
recommended route at this size.

## 10. Before launch — the DPIA's own checklist

- [ ] **[COUNSEL]** Lawful basis per operation confirmed (§3).
- [ ] **[COUNSEL]** Telemetry retention-past-erasure decided (R6, §7).
- [ ] **[OPS]** Backup retention proven not to outlive a crypto-shred (R6).
- [ ] **[COUNSEL]** DPO question answered; if required, appointed (§9).
- [ ] **[COUNSEL]** Scaleway DPA and sub-processor list filed (§4).
- [ ] **[COUNSEL]** DDV permits agent-submitted enrolment for a verified
      subject — the gating question for the flagship Tier-1B rung.
- [ ] **[COUNSEL]** Consumer copy reviewed for outcome promises (docs/05 §3,
      UWG). The ladder makes no promises today; keep it that way.
- [ ] **[COUNSEL]** Privacy notice drafted, including the TEM relay (R3).
- [ ] Deployment posture declared (A/B/C — `docs/14-decentralised-deployment.md`), and for B/C:
      this DPIA instantiated by that operator with their own stack in §4.
- [ ] **[COUNSEL]** OQ-23/OQ-24 answered (posture-A GDPR applicability; self-representation vs RDG).
- [ ] Prior-consultation question settled (§8).
- [ ] This document signed and dated by controller + DPO (postures B/C).

## 11. Review

Re-assess on: any new tier reaching users; the legal pipeline becoming
launchable (which requires a substantial amendment); any new sub-processor; any
security incident; **any change to the deployment/federation model — in particular
anything that creates a cross-node flow, which §4 currently states does not exist**;
otherwise annually.
