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

- Controller: Scraper (entity **[COUNSEL]** — GmbH/UG not yet formed)
- DPO: **[COUNSEL]** — not appointed. See §9.
- Version 0.1 · 2026-08-05 · owner: founder + counsel jointly

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
  achieves the same outcome, and records why (`protection-router.repo.ts`,
  tested in `protection-router.integration.test.ts`).
- The identity packet sends the *minimum* proof a controller accepts, never the
  maximum, and refuses to send an ID document for an unconditional marketing
  objection (`identity-packet.ts`).

**[COUNSEL]** Lawful basis per operation. Working assumption: Art. 6(1)(b)
performance of the contract for Tiers 0/1a/1b, since the user asked for exactly
this service; Art. 6(1)(f) legitimate interest for the telemetry ledger, with
the balancing test at §7. Confirm both.

## 4. Data flows and recipients

- **Hosting:** Scaleway, `fr-par` (ADR D22). EU-owned, EU-operated. No US
  parent, therefore no Chapter V transfer to argue.
- **Mail:** Scaleway TEM, both directions.
- **Key management:** Scaleway KMS; the KEK never leaves it.
- **Recipients outside Scraper:** (a) companies the user chooses to give an
  alias to — their choice, not ours; (b) suppression programme operators (DDV),
  receiving name + address for server-submitted enrolments only.
- **No US-region inference on personal data.** The model provider is an
  interface defaulted to EU (docs/06 M11), and the ladder invokes no model at
  all.

**[COUNSEL]** Scaleway sub-processor list and DPA (Art. 28) to be reviewed and
filed. The TEM relay is the sensitive one: it necessarily sees who contacts a
user at their alias.

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

**Residual risk: LOW**, and structurally so rather than procedurally.

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

**Residual risk: currently UNRESOLVED.** Do not launch on this one.

### R7 — Alias misuse damages the user (LOW–MEDIUM)
An alias used where a real identity is legally required (Art. 5(1)(d) accuracy)
could invalidate a contract or a claim.

- **The prohibited contexts do not exist in the enum** — legal, financial,
  credit, insurance and government are not values a caller can pass.
- **A second, independent database gate** refuses an alias at a prohibited
  controller type whatever the app believes.
- The UI states plainly where aliases must not be used.

**Residual risk: LOW.**

## 6. Data minimisation and retention

| Data | Retention | Basis |
|---|---|---|
| Account email, password hash | Life of account | Contract |
| Verified identity (encrypted) | Life of account; crypto-shred on erasure | Contract |
| TOTP secret (encrypted) | Life of account | Security (Art. 32) |

> **Row 2 is a TARGET, not the present state** (2026-08-13 audit H2 — counsel must not review a
> claim as an implementation): `Identity.legalName`, `dateOfBirth` and `IdentityAddress` are today
> PLAIN columns; the envelope encrypts only the TOTP secret, and no crypto-shred/erasure path
> exists yet (`userErasedAt` is structurally null, TODO(safety) in auth.service.ts). Both are
> launch-gated in PRE-SEND-CHECKLIST.md ("Identity, mandate, evidence" + "our own DSR endpoint")
> and must be TRUE before this DPIA is signed. The credit-file store is likewise not yet
> segregated (same Postgres role — checklist D6 box).
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

**[COUNSEL]** Whether Art. 37(1)(b)/(c) or BDSG §38 obliges a designation.

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
- [ ] Prior-consultation question settled (§8).
- [ ] This document signed and dated by controller + DPO.

## 11. Review

Re-assess on: any new tier reaching users; the legal pipeline becoming
launchable (which requires a substantial amendment); any new sub-processor; any
security incident; otherwise annually.
