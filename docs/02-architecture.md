# 02 — Architecture

## Design principle

**Everything expensive is done once per controller and amortised across all users; per-user marginal
work is done by cheap models, deterministic rules, and rails.** The proprietary asset is the **census**
(controllers + channels + legal bases + response norms + per-controller stats). The orchestrator makes
escalation systematic by treating every rights-action as a ticket with a statutory clock.

## Services (Phase 0)

```
                    ┌──────────────┐
   Web app  ───────▶│   apps/api   │  NestJS · REST · auth · authZ · Stripe
   (Next.js)        │              │  creates RightsRequests (gated on VERIFIED identity)
                    └──────┬───────┘
                           │ enqueue workflow
                    ┌──────▼───────┐
                    │ apps/worker  │  Temporal workflows · the state machine · the playbook engine
                    │              │  channels: email · web-form(→human) · postal(API)
                    └──┬────────┬──┘
        renders text   │        │  sends clock-critical mail (Einwurf-Einschreiben)
        from templates │        │
              ┌────────▼──┐  ┌──▼─────────────┐
              │ packages/ │  │ postal provider │ LetterXpress / Pingen (interface)
              │  core     │  └────────────────┘
              └────┬──────┘
   inbound docs    │  parse (isolated)
        ┌──────────▼───────────┐
        │ services/doc-sandbox │  OCR + small EU-hosted LLM · structured-output only · no tools
        │  (untrusted input)   │  one doc per context · output validated before any state change
        └──────────────────────┘

  Postgres (Prisma) · S3-compatible object store (EU) · QTSP timestamp API · ident provider API
```

## Stack choices (opinionated defaults; change with a note in ARCHITECTURE-DECISIONS.md)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, Node 20+ | one language across api/worker/sandbox/extension-later |
| API | NestJS | structure, DI, guards map cleanly to the safety gates |
| DB | PostgreSQL + Prisma | relational census + tickets + evidence; migrations |
| Durable workflows | **Temporal** (interface-wrapped; BullMQ acceptable for M0/M1) | statutory clocks, retries, human-in-loop steps, idempotency |
| Object storage | S3-compatible, EU region | evidence files; lifecycle/purge rules |
| Doc parsing LLM | EU-hosted small model (Mistral EU / Azure OpenAI EU / self-host) | data residency; cheap per-doc |
| Identity | IDnow / Nect / POSTIDENT-eID (interface) | bank-ident/eID; QES for mandate |
| Postal | LetterXpress / Pingen (interface) | hybrid mail + registered mail |
| Timestamping | eIDAS QTSP (interface) | qualified time for the statutory clock |
| Billing | Stripe (EU entity) | €5–10/mo subscription |
| Hosting | Hetzner/Scaleway/OVH or AWS eu-central-1 | EU region, cost |

## The provider interfaces (all EU-configurable, all stubbable)

Define these as TypeScript interfaces in `packages/core` so implementations are swappable and dev can run
without real vendor accounts:

- `IdentityProvider` — `startVerification(user)`, `getStatus(user)`, `signMandate(user, mandateDoc): QES`.
- `PostalProvider` — `send(letter, {registered: boolean}): {providerId, proof}`.
- `InboundMail` — `poll(): RawDocument[]` (scanned replies for controllers that answer by post).
- `DocSandbox` — `parse(rawDocument, schema): {structured, confidence}` (isolated; no side effects).
- `Timestamper` — `anchor(hash): QualifiedTimestamp`.
- `ModelProvider` — `complete(prompt, {schema, region:'eu'})`.
- `Mailer` — transactional + legal-request email with aligned SPF/DKIM/DMARC.

## The "Controller Gateway" (introduced properly in Phase 1, stubbed in Phase 0)

A cross-cutting sending layer that every outbound request passes through:
- per-controller **rate limiting / queueing** (don't look like an attack),
- **idempotency keys** per `(user, controller, requestType)`,
- SPF/DKIM/DMARC-aligned **rotating send domains** + deliverability monitoring,
- **playbook-health** monitors (DOM-diff / synthetic canary submissions to detect when a broker changes
  its form or letter layout — fail closed to the human queue),
- QTSP timestamping + registered mail for clock-critical steps.

In Phase 0 you may implement a thin version (idempotency + basic rate limit + one aligned send domain),
but design the seam now.

## Non-functional requirements
- **Residency:** personal data never leaves the EU (storage or inference). Enforced by config + review.
- **Encryption:** envelope-encrypt each user's data map; separate KMS-held keys; credit data segregated.
- **Retention:** raw response documents purged after normalisation window; normalised record + evidence hash retained.
- **Auditability:** every state transition is an append-only `RequestEvent`; evidence is hash-chained.
- **Idempotency & retries:** all external calls idempotent; workflows resumable.
