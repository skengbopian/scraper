# Kickoff prompt for Claude Code

Copy everything in the fenced block below into Claude Code (run `claude` inside the `scraper/` folder
so it picks up `CLAUDE.md` automatically), or paste it as your first message.

```
You are the lead engineer scaffolding Phase 0 of "Scraper", a Germany-first consumer data-rights
platform. Read CLAUDE.md and every file under docs/ (in numeric order) before writing code. The market
and product rationale is summarised in docs/00-overview.md.

Your goal for this first session: stand up the skeleton of the Phase-0 loop described in
docs/01-mvp-scope.md, with correctness and safety prioritised over completeness. Specifically:

1. Propose and confirm the monorepo layout (pnpm workspaces: apps/api, apps/worker,
   services/doc-sandbox, packages/core, packages/db) and initialise it with TypeScript, NestJS,
   Prisma + PostgreSQL, and a durable workflow layer (Temporal preferred; abstract it behind an
   interface so BullMQ can back the first milestone if needed).

2. Implement the data model in docs/03-data-model.md as Prisma schema. Get the entities and relations
   right: User, Identity (verification state), Controller (census), Playbook, RightsRequest (the ticket),
   RequestEvent (state-machine transitions), ControllerResponse, EvidenceRecord, Mandate.

3. Implement the RightsRequest state machine exactly as specified in schema/request-state-machine.md,
   with the one-month statutory clock. Unit-test every transition, including the deadline-expiry path
   that drafts (does not auto-send) an Art. 77 complaint.

4. Implement the playbook engine per docs/04-playbook-spec.md: load a YAML playbook (validate against
   schema/playbook.schema.json), render the correct template from templates/ with the user's
   verified-identity fields, and choose the delivery channel (email | web-form | postal). Wire the
   three example playbooks in playbooks/. For Phase 0, the L2 browser-agent channel is OUT — a
   web-form controller falls back to the human queue.

5. Enforce the safety gates as code, not comments: (a) a request cannot be created unless
   Identity.status == VERIFIED and the request subject is derived from that Identity; (b) idempotency
   on (user, controller, requestType); (c) an interface for the untrusted-document sandbox such that
   parser output is validated before any state transition.

Do NOT build (defer per docs/01-mvp-scope.md): the browser extension, canary/receipts module, the
Score Studio dispute engine or simulator, L2 browser agents, or any feature that acts on data about a
third party.

Work in small, reviewed steps. After scaffolding, produce: (a) a short ARCHITECTURE-DECISIONS.md
capturing choices and open questions, and (b) a checklist of everything a human must do before the
first real letter is sent (counsel review of templates, ident provider contract, postal + QTSP
accounts, DPIA sign-off). Flag every legal question as TODO(counsel) and every identity/evidence
question as TODO(safety).

Start by reading the docs and then showing me the proposed repo layout and the Prisma schema for review
before generating the rest.
```

## Notes for the human operator

- Before the agent's output can send anything real, you need: German data-protection + RDG counsel sign-off
  on `templates/`, a bank-ident/eID provider (IDnow, Nect, or POSTIDENT-eID), a hybrid-mail account
  (LetterXpress or Pingen), an eIDAS QTSP for qualified timestamps, EU-region hosting + model inference,
  and a completed DPIA. See `docs/05-legal-guardrails.md` and `docs/06-security-safety.md`.
- Keep the agent scoped: if it starts building the extension, canaries, or Score Studio, point it back to
  `docs/01-mvp-scope.md`.
