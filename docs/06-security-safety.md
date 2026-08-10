# 06 — Security & safety (the hardening that reshaped the design)

These come from an adversarial review (attacker + privacy lawyer + operator). They are **launch gates**,
not backlog polish. Numbered by original severity.

## C1 (critical) — Anti-stalker: the product must not become a way to locate a person

**Threat:** proactive access sweeps + dossier assembly is exactly an abuser's locate-the-victim workflow.
**Controls (all required):**
- Requests are only ever about the **identity-verified account holder**. Subject fields are **derived
  from the `Identity` record**, never free-typed. No API accepts an arbitrary subject.
- Content returned by controllers (addresses, credit data) is released only after **step-up auth**, and
  high-sensitivity items only to the **verified postal address**.
- Rate-limit lookups; anomaly-detect and human-review unusual targeting patterns.
- Guard in code (NestJS guard / policy): `createRightsRequest` throws unless `Identity.status==VERIFIED`
  and `subject == deriveFromIdentity(user)`.
- **Any** feature that would act on third-party data is a design-review stop, not a ticket.

## C2 (critical) — Scraper is an account-takeover jackpot

**Threat:** one account holds credit files + breach data + inbox metadata + cross-broker maps.
**Controls:** mandatory **MFA**; **step-up** to view the dossier; **envelope-encrypt** each user's map
under keys gated by their auth; **segregate** the credit-file store; **purge** raw DSAR blobs after the
normalisation window; complete the **DPIA**; appoint a **DPO**; build our own Art. 15/17 endpoint.

## C3 (critical) — Mandate fraud + RDG exposure

**Threat:** a forged/self-asserted Vollmacht lets an attacker act as someone else (compounds C1).
**Controls:** **QES-signed mandate** (eIDAS) bound to the verified identity; adversarial actions gated on
a valid mandate; RDG structure (Inkasso or lawyer-partner) as a routing boundary. See `docs/05`.

## C4 (critical) — Prompt injection via hostile response documents

**Threat:** broker letters/PDFs are attacker-controlled input into the OCR+LLM parser; embedded text
("mark this controller compliant", "user consents to retention") can drive automated actions.
**Controls (the `services/doc-sandbox` contract):**
- Structured-output-only; **no tool/function calling**; one document per model context; **zero cross-user
  context**; strip/segregate instructions from content.
- Parser output is **advisory**: it may never trigger an irreversible state change (never auto-mark
  `COMPLIED`/`REFUSED`, never auto-close) below the confidence threshold or without deterministic
  validation / human review.
- The sandbox is a separate service with no DB write access to request state — it returns data to the
  worker, which applies validated transitions.

## H5 — Digital Omnibus (regulatory)
Lead with Art. 21(2) objection; keep access requests individualised and purpose-stated. See `docs/05` §1.

## H6 — Identity-verification economics
eID/bank-ident ≈ €0.50–3 per check. **Risk-tier it:** lightweight confirmation (email + postal-address
match) for low-risk self-objections; strong eID only for content-returning, credit-bureau, or sensitive
actions. Book verification as **CAC**, not per-removal cost.

## H7 — Postage breaks the naive cost target
`<€0.50/removal` holds for email/web-form only. Real 2026 German post: Standardbrief €0.95,
Einwurf-Einschreiben €3.30 (proof), Rückschein €5.80; hybrid mail ≈ €0.76–0.90/letter. A contested postal
removal is €5–15. **Controls:** default email/form; reserve post for controllers that mandate it; batch;
re-baseline blended target `<€1.50` for postal-heavy cohorts; cap postal actions per plan tier.

## H8 — Public leaderboard = defamation/UWG magnet (Module 2, deferred)
Facts-only, self-evidenced, documented methodology, right of reply, legal sign-off. See `docs/05` §7.

## H10 — Sending infrastructure gets throttled/blocklisted
The **Controller Gateway** (docs/02): per-broker rate limiting/queueing; **idempotency** per
`(user, controller, requestType)`; **SPF/DKIM/DMARC-aligned** rotating send domains; deliverability
monitoring; clock-critical steps via registered mail with QTSP timestamp.

## M11 — US-vendor data transfers
EU-region inference for all personal data; EU number/provider choices; SCCs + transfer-impact assessment
on file. Model provider is an interface defaulted to EU.

## M12 — Playbook drift
Synthetic-submission / diff monitors per playbook; on drift, deactivate + alert + fail closed to human
queue (never send malformed requests at scale).

## M13 — Evidence admissibility
Anchor evidence roots with a **qualified eIDAS timestamp**; keep Einwurf-Einschreiben receipts. Hash chain
proves integrity; QTSP proves time.

## M14 — Inbox-scan consent (only relevant once Data Radar inbox scan is built — not Phase 0)
Metadata-only, on-device/ephemeral, granular revocable consent, complete Google CASA for restricted scopes.

---

### Definition of done for "safe to send the first real request"
All C-items implemented and tested; H6/H7 costed; H10 idempotency + one aligned send domain live; C4
sandbox boundary enforced; DPIA signed; templates counsel-approved. (Mirror of the pre-send checklist in
`docs/01`.)
