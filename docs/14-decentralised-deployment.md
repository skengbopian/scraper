# 14 — The decentralised launch posture

**Decision (2026-08-14, product owner):** Scraper launches as a **decentralised service** — software
EU citizens run to take back control of their own data — not as a conventional centrally-operated
business. This document is the normative record of what that changes, what it deliberately does not
change, and which questions it opens. `docs/11-dpia.md` §4/§6, `docs/05-legal-guardrails.md` §2 and
`CLAUDE.md` carry the consequences in their own registers; this file is where the reasoning lives.

Nothing in this document relaxes a safety rule. Where the pivot *weakens* a guarantee, that weakening
is stated in §4 rather than papered over — an honest smaller promise beats a large one the
architecture can no longer keep.

## 1. The three deployment postures

Everything downstream forks on **who operates the node and whose rights it exercises**, so the
postures get names and the other documents refer to them by letter.

| Posture | Who runs it | Whose rights | Status |
|---|---|---|---|
| **A — self-host** | The data subject themselves (own hardware or own rented EU VM) | Their own, only | **The launch posture** |
| **B — operated node** | Someone hosting for others (family, a Verein, a community) | Their members' | Supported by the same code; carries operator duties (§5) |
| **C — hosted instance** | A single central operator | Its customers' | The original assumption. No longer the plan; everything written for it remains true if one is ever run |

The codebase is identical across all three. What differs is who holds the KEK, who owes the GDPR
duties, and — critically — who the safety controls can and cannot bind (§4).

**Declared posture of the first node:** `TODO(owner):` — record A, B or C here, with the operator's
name and the date, before that node sends anything. This is not paperwork. Almost everything a
reviewer needs to know forks on it: whether `docs/11-dpia.md` binds at all (OQ-28), whether the RDG
is engaged (OQ-29), who the controller is, and which of §5's operator duties apply. Readiness carries
it as a `☐` COUNSEL row precisely because no script can answer it — the software cannot tell whose
hardware it is running on, which is the whole point of §4.
`docs/15-entity-and-governance.md` holds the entity, licence and funding decisions this depends on.

## 2. What gets legally SIMPLER, and why it is honest to say so

Posture A collapses the hardest legal questions this project carries, and not by wishful thinking —
by the structure of who is acting:

- **Self-representation instead of agency.** Every letter in `templates/` is already written in the
  first person and signed `{{legalName}}` — "hiermit widerspreche ich", not "we object on behalf of
  our client". On posture A the sender and the subject are the same person: there is no agent, no
  Vollmacht to construct, no Botendienst framing to defend, and the RDG — which governs providing
  legal services **to others** — is not engaged by someone exercising their own rights with their own
  tooling. `TODO(counsel):` confirm (OQ-29); the claim is deliberately stated as structural, not as a
  legal conclusion.
- **The purpose objection weakens.** CJEU C-526/24 lets controllers refuse Art. 15 requests whose
  purpose is alien to data protection — the risk `docs/05` §1 designs against. A person running their
  own node, asking about their own data, one controller at a time, is the paradigm case of the right
  being used for its purpose. The anti-bulk architecture (one subject per account, rate caps, no
  sweep engine) remains load-bearing on every posture.
- **The mandate object survives with a smaller job.** `Mandate` stays as the recorded, revocable
  authorisation that gates dispatch (`runGuards` requires a live one) — on posture A it records the
  user's own standing instruction to their own node, which is still worth having as an audit artefact
  and a kill switch. What it stops being is an agency claim toward anyone.
- **Whether posture A is GDPR-regulated processing at all** is an open counsel question, not an
  assumption: Art. 2(2)(c) exempts purely personal activity, and a person processing their own data
  to exercise their own rights is a strong candidate. `docs/11-dpia.md` therefore binds postures B/C
  and serves posture A as engineering documentation (OQ-28).

## 3. What the code already does right for this posture — found, not built

Three existing design decisions turn out to be decentralisation-ready, and naming them stops anyone
"fixing" them:

- **The manual delivery-proof route is the self-hoster's provable send.** OQ-11's automated
  Auslieferungsbeleg fetch assumed a vendor account most individuals will never have. But
  `POST /ops/requests/:id/delivery-proof` (audit F3a, manual half) means a self-hoster can post an
  Einwurf-Einschreiben at a branch, wait for the receipt, and record it — the same
  `provableSendConfirmed`, the same branded-evidence discipline, no vendor required. The QTSP anchor
  is still required for the clock to start (§5); the point is that the *postal* side needs no
  integration at all.
- **`HUMAN_OPS` means what it always meant.** On posture A the user grants themselves the ops role
  and is their own reviewer. The graph invariant — ESCALATED has one inbound edge and it demands a
  human actor — loses nothing: its job was never "a Scraper employee", it was "no automation files an
  Art. 77 complaint", and that holds identically on a single-user node.
- **Nothing phones home.** Verified against the tree at this commit: the only network egress is
  through the provider interfaces (`packages/core/src/providers/index.ts` — mailer, postal,
  timestamper, ident, model), all stubbed by default; the census ships as static data in
  `apps/api/src/census/`; playbooks and templates ship in the repo; statistics stay in the node's own
  database. There is no central telemetry, no update push channel, no registry of installs. Keep it
  that way — a "phone home for corpus updates" feature is a recipients-analysis change and a
  spec-level decision, not a convenience patch.

## 4. What gets WEAKER, stated plainly — the trust anchor moves

`CLAUDE.md`'s one rule is enforced by identity binding: every outbound request is about the
authenticated, identity-verified account holder. Centrally operated, the ident provider was *ours*
and a stalker could not fake a verification. Decentralised, **each node runs its own identity gate on
infrastructure its operator controls** — and no software control can bind the person who administers
the database it runs in. A malicious self-hoster can mark any identity VERIFIED (the dev stub writes
exactly that shape under dev posture; an operator with `psql` needs no stub).

What this means, without flinching:

- **The R1 guarantee is scoped per node.** Within a node, against its users, everything holds: no
  free-typed subject, composite-FK binding, rate caps, anomaly review. Across the node boundary the
  guarantee is only as good as the operator. `docs/11-dpia.md` R1 now says so, and R8 carries the
  operator-abuse risk explicitly.
- **What still stands between a malicious operator and a victim** is deliberately *not ours*: a
  forged rights request is impersonation toward the controller, unlawful entirely independent of this
  software; controllers run their own requester verification (the reason `IdentityPacket` exists);
  and — the part we control — **the software contributes no lookup capability**. No cross-node
  queries, no shared subject registry, no people-search, no aggregation of anyone's answers anywhere
  central. A stalker who forks this repo gains a letter-writing convenience they already had with a
  word processor, and nothing more. Keeping the product useless as a search tool *even to its own
  operator* is the load-bearing residual control, and it is a property of what we refuse to build.
- **Production posture still refuses stub identity.** The M2 boot guards
  (`assertApiStartupSafe`, and the worker's refusal to boot non-dev without real provider names)
  mean a node cannot reach production posture with the ident gate stubbed. An operator can of course
  run dev posture or edit the code — open-source safety controls bind honest operators and raise the
  effort for dishonest ones; they cannot bind a fork. Say that in every safety conversation rather
  than implying more.
- `TODO(safety):` whether posture B (operating for OTHERS) should demand more than posture A before
  first send — e.g. the readiness gate refusing playbook activation until a real ident provider has
  verified at least the operator's own identity. Recorded as OQ-31; do not implement ahead of the
  decision.

## 5. What must stay true on EVERY node

Per-node duties the software defaults enforce where it can and the deployment guide must state where
it cannot:

1. **EU residency** — hosting, storage, inference. `MODEL_REGION` defaults to `eu`; the boot gates
   refuse unset CORS/KEK postures outside dev; the operator owns the hosting choice. (`CLAUDE.md` §3.)
2. **The counsel gate's mechanics are unchanged; the actor changes.** Playbooks ship `active: false`
   and templates ship DRAFT until *upstream* counsel review lands — that is a property of the
   published corpus, not of any node. Activation remains a deliberate act against the node's own
   DATABASE row, never the YAML; on posture A the human taking responsibility is the user. What
   upstream sign-off means for a corpus consumed by nodes upstream never meets is OQ-30.
3. **Evidence discipline** — the append-only ledgers, the branded provable-send id, the QTSP
   requirement for statutory clocks. A node without a QTSP account simply cannot start an Art. 12(3)
   clock (`UnprovableSendError` fails closed to the human queue); it can still send, chase, and
   escalate on refusals, because a controller's reply proves receipt. That degraded-but-honest mode
   is the expected self-host default until QTSP access is affordable per node. `TODO(counsel):`
   OQ-11 already covers what the clock may key on.
4. **Key custody is per node** — `EnvKekResolver` with an operator-held KEK is the reference posture
   A setup; a KMS is posture B/C hygiene. Backups are the same honest gap as centrally
   (`docs/11-dpia.md` R6), now per operator: a self-hoster's backup discipline is their own erasure
   completeness.
5. **No third-party subjects, no bulk** — unchanged, unconditional, every posture.

## 6. The census and the statistics — per-node, and the "moat" framing is retired

`docs/03` calls the controller census "the moat" and `docs/05` §7 anticipates publishing per-controller
compliance statistics. Under the pivot:

- The census is a **shared address book maintained upstream** (seeded from Datenanfragen.de CC0 data,
  `docs/13` §recommendation) — it ships in the repo like the playbooks. It is a commons now, not a moat;
  the business-defensibility framing is retired with the business.
- **Compliance statistics stay in each node's database.** No aggregation exists, none is planned in
  this repo, and building one would be a new processing activity with its own DPIA, a provenance
  problem (nodes can lie; a poisoned feed defames a controller), and a defamation exposure resting on
  evidence the aggregator does not hold. `docs/05` §7's publish-rules apply to *whoever publishes* —
  which, with no aggregator, is nobody. Recorded as OQ-30; the census `outcome` vocabulary and the
  `NO_PROVABLE_CLOCK` exclusion stay exactly as specified so that any future, deliberately-designed
  aggregation has honest inputs.

## 7. Open questions this pivot creates (recorded here; indexed in `docs/counsel-review-packet.md` §2)

> **Renumbered 2026-08-15: these four were OQ-23..26 and are now OQ-28..31.** ADR-036 had already
> assigned OQ-23..26 to four unrelated questions (partial erasure at a bureau, Einwurf to a Postfach,
> CRIF's venue, silence without a provable channel), and those numbers were already cited from
> individual playbook rows and from `apps/worker` — so the older set kept them. If you hold notes
> against the old numbering, add five. `tools/spec-audit/oq-check.mjs` now fails the build if any
> number is defined twice or cited without a definition.

| OQ | Question | Owner |
|---|---|---|
| **OQ-28** | Posture A and GDPR applicability: does Art. 2(2)(c) (purely personal activity) cover a data subject self-hosting to exercise their own rights? What residual duties (Art. 32-style care) survive even if so? | counsel |
| **OQ-29** | Confirm the self-representation analysis: posture A engages neither RDG nor a Vollmacht requirement; define exactly where posture B crosses into Rechtsdienstleistung (extends OQ-14, which keeps the adversarial-work boundary for operated deployments) | counsel |
| **OQ-30** | The shipped corpus under decentralisation: what upstream counsel sign-off can honestly mean for nodes we never meet; the activation-responsibility disclaimer wording; and whether any federated statistics aggregation is ever lawful/wise (lawful basis, provenance, defamation) | counsel + product |
| **OQ-31** | Posture B safety floor: should the readiness gate demand a real ident-provider verification before an operated node may activate any playbook (see §4 `TODO(safety)`) | safety + counsel |

## 8. What was deliberately NOT done in this pass

- No federation protocol, no node discovery, no shared services of any kind — there is nothing to
  design until OQ-30 answers whether there should be.
- No weakening of the identity gate to make self-hosting cheaper. The eID/POSTIDENT interface stays;
  a posture-A node that stubs it in dev posture is exercising the same honesty the fixture account
  does, and one that stubs it in production posture does not boot.
- No packaging/distribution work (containers, one-click installers). That is real work the pivot
  demands eventually; it is engineering logistics, not spec, and it should not ride in a
  documentation commit.
- `docs/00`/`docs/02` keep their original business framing as historical record — `docs/09`
  supersedes docs/00's module list, and this file supersedes the *operating model* framing wherever
  the two touch. Rewriting history in place is how repos lose the ability to explain their own
  decisions.
