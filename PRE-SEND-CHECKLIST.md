# Pre-send checklist — humans only

> **Imported from the pre-audit line** (`~/Downloads/scraper`, commit `cc9dcb4`) in port wave 1,
> per ADR-030. It complements — does not replace — `ARCHITECTURE-DECISIONS.md` §4 ("Before the first
> real letter is sent") and `docs/counsel-review-packet.md`. Two lines were checked against this
> line's stricter clock rule and hold unchanged: the `POSTAL_PROOF` evidence requirement (§105) and
> "correct deadline + a drafted, NOT sent, Art. 77 complaint" (§135) — both are consistent with
> ADR-012, under which only a registered, QTSP-anchored send sets `deadlineAt` at all.
> `pnpm readiness` (`scripts/readiness.mjs`) exists since the 2026-08-13 audit — run it; a ☐ row
> in its output is a humans-only box no script can tick.

> **Run `pnpm readiness` first.** Everything mechanically checkable is verified
> by `scripts/readiness.mjs`, split into the two tracks that gate different
> products (LEGAL PIPELINE vs LEVERAGE LADDER). This file remains the
> authority; the script is what stops a box being ticked optimistically.

**No real rights request leaves this system until EVERY box below is checked.**
This mirrors docs/01 §"pre-send human checklist" and docs/06 §"Definition of
done", and adds the scaffold's own gates. The technical enforcement is that all
`Controller.active` and `Playbook.active` flags ship `false` and the dispatch
guard refuses inactive rows — activation is the human act of signing off.

## Legal (counsel sign-off required)

- [ ] Every file in `templates/` reviewed and approved by German
      data-protection counsel (`art21-werbewiderspruch.de`,
      `art15-datenkopie.de`, `art17-loeschung.de` — all currently DRAFT).
- [ ] Art. 77 complaint template written by counsel (the current draft builder
      emits placeholder text and must not be sent — TODO(counsel) in code).
- [ ] RDG structure decided: Inkassodienstleister registration OR
      lawyer-partner white-label; adversarial routing boundary configured
      accordingly (docs/05 §2).
- [ ] Botendienst framing for non-adversarial requests confirmed; per-type
      mandate policy confirmed (OQ-A). The imported wording named the pre-audit
      line's `A:packages/core/src/domain/policy.ts`, which was never ported: in
      this line the policy is data, not a module — `Mandate.scope` is a list of
      request types, and `packages/core/src/state-machine/guards.ts` refuses a
      request no live mandate covers ("no live Mandate covers <requestType>"),
      re-checked at dispatch and not only at creation. What counsel decides is
      therefore which request types a single signed mandate may carry.
- [ ] Every controller endpoint in the census verified against the
      controller's CURRENT Datenschutz page (all seed rows carry
      TODO(counsel)); only then set `Controller.active = true`.
- [ ] Each playbook's wording/validation strings reviewed; only then set
      `Playbook.active = true` (version pinned; changes bump the version).
- [ ] Marketing/product copy reviewed: no outcome promises (docs/05 §3, UWG).
- [ ] Repeat-request policy after COMPLIED decided (Art. 12(5), OQ-B).

### Provenance module (docs/09, ADR D30) — additional counsel gates

- [ ] `templates/art15g-herkunft.de.md` reviewed and approved (currently DRAFT).
      It names SCHUFA's Art. 14 section 2.3 "Datenlieferanten" clause verbatim
      via the `isSchufa` template flag — confirm the citation is still accurate
      against the CURRENT notice, and that the demand's scope is defensible.
- [ ] Art. 15(1)(g) intake route verified per bureau against the live
      Datenschutz page, then `Controller.art15SourceRouteVerified = true`. A
      database trigger (migration 18f) refuses to activate a provenance
      playbook until this is done — this box IS that verification.
- [ ] Art. 77 venue confirmed per controller before any complaint is filed:
      seeded as infoscore + CRIF -> LfDI BW, Schufa + Acxiom -> HBDI,
      AZ Direct + Deutsche Post Direkt -> LDI NRW, Regis24 -> BlnBDI. Confirm
      the one-stop-shop position for Experian-group entities in particular.
- [ ] **Art. 17(1)(d) at a bureau** — confirm the framing for a PARTIAL erasure
      of the broker-sourced layer only (docs/07 says bureaus are not an erasure
      target; docs/09 routes this anyway — ADR D30.6 reconciles them, counsel
      must confirm), and that requesting it does not risk an Art. 12(5)
      "excessive" characterisation when chained after an access request.
- [ ] Broker watchlists in `playbooks/provenance.*.yaml` reviewed. The
      watchlist is the ONLY thing that can mark a source as a broker, so an
      entry added here directly causes erasure demands to be drafted.
- [ ] `infoscore` ships `namesSourcesInArt14: true` — confirm the current
      version of their Art. 14 notice still names AZ Direct before relying on a
      denial being recorded as `CONTRADICTS_ART14` in any complaint.
- [ ] Fraud Shield: `EINMELDUNG_FRAUD` mandate policy decided (OQ-G) BEFORE
      that module ships. It currently defaults to no mandate required.

- [ ] **The Art. 15 templates claim an enclosed redacted ID copy; nothing can
      attach one** (OQ-J, spec audit C6). `art15g-herkunft.de` and
      `art15-datenkopie.de` both assert the enclosure; there is no attachment
      support in the send path. A bureau will refuse for failed identity
      verification — the exact string those playbooks' `refusedIf` matches. Fix
      the capability or the wording BEFORE either instrument is activated.

- [ ] **Verify every external link this product points a consumer at.** The
      imported wording named A's `A:apps/web/src/lib/data-holders.ts` and its
      `urlVerified` flag; neither was ported, and the "Link not yet verified by
      us" label it describes does not exist in `apps/web-next`. The box still
      binds, against the two surfaces this line actually serves: the Tier-1
      self-serve removal routes in
      `packages/core/src/leverage/broker-routes.seed.ts` (verified 2026-08-09,
      each carrying `lastVerifiedAt`; served to the browser as `selfServe.url`
      by `apps/api/src/census/census.controller.ts` and rendered as the guided
      handoff), and the CC0 community contact channels in
      `apps/api/src/census/datenanfragen.snapshot.ts`, which are sourced rather
      than curated and are never authoritative for a send. Re-check on the
      docs/08 §2 schedule: brokers change endpoints, a dead link starts nothing,
      and a stale one sends someone to the wrong place to check their credit
      file. `lastVerifiedAt` is the timestamp of a check, not a freshness
      guarantee — only this box is the guarantee.

### Template prose defects found by adversarial review (OQ-I) — counsel-owned

- [ ] `art17-loeschung.de` asserts the user already filed an Art. 21(2)
      objection. Nothing enforces that ordering, so the letter can state a
      falsehood. Either soften the wording or gate the instrument on a prior
      objection.
- [ ] The §147 AO / §257 HGB retention caveat that the instrument matrix and
      the generated erasure playbooks both cite as the reason this letter does
      not over-promise is NOT actually in the template. Add it or drop the claim.
- [ ] `art17-loeschung-herkunft.de` asserts the user has no contractual
      relationship with the named broker. True in the expected case, unverified
      in general — confirm the framing.
- [ ] 45 generated playbooks now ship (all inactive). Each carries the census
      endpoint verbatim, and many census rows still hold the literal string
      "TODO(counsel): verify" where an address belongs. Verify per controller
      before setting `active: true`; `pnpm dev:activate` is DEV ONLY and is not
      a sign-off.

## Identity, mandate, evidence (safety)

- [ ] Ident provider contract signed (IDnow / Nect / POSTIDENT-eID), real
      adapter implemented behind `IdentityProvider`, stub disabled
      (`IDENTITY_PROVIDER != stub`), webhook signature verification enabled —
      the dev webhook (`ALLOW_STUB_IDENT_WEBHOOK`) MUST be off in production.
- [ ] QES mandate flow live and tested end-to-end (signMandate → Mandate row
      bound to the verified identity).
- [ ] QTSP account live (`QES_PROVIDER`/`QTSP_ENDPOINT`); stub timestamper
      ("stub-qtsp:" refs) disabled. Evidence chain + QTSP anchoring verified on
      a test request.
- [ ] Postal provider account live (LetterXpress/Pingen) incl.
      Einwurf-Einschreiben; proof refs land in `POSTAL_PROOF` evidence.
- [ ] Aligned send domain: SPF/DKIM/DMARC configured and verified; provable-
      send confirmation (DKIM-aligned acceptance) implemented — the stub
      mailer's auto-confirm is dev-only (TODO(safety) in worker dispatch).
- [ ] KMS-backed KEK resolver deployed (dev scrypt resolver disabled —
      TODO(safety)); key rotation procedure documented.
- [ ] `scraper_app` / `scraper_credit` DB roles provisioned per environment;
      credit read path uses separate credentials; grants from hardening
      migration verified (D6).
- [ ] MFA enforced at login and step-up auth on dossier/credit reads — the
      scaffold's header-stub guards replaced with real authn (TODO(safety)).
- [ ] Lookup rate limits + anomaly review queue live (C1).

## Compliance & infrastructure

- [ ] DPIA completed and signed; DPO appointed.
- [ ] EU-only hosting confirmed for DB, object store, Redis, and ALL model
      inference (`MODEL_REGION=eu`; no US-region APIs on personal data — M11);
      SCCs/TIA on file for any remaining vendor.
- [ ] Retention jobs verified: raw response docs purge after the normalisation
      window; evidence + normalised records retained.
- [ ] Our own DSR endpoint tested (Art. 15 export, Art. 17 crypto-shred).
- [ ] Backups encrypted, EU-region, restore tested.
- [ ] `NODE_ENV=production` boot check passes: no `*_PROVIDER=stub` (the
      worker refuses to start otherwise).

## Final gate

- [ ] A dry run against a controlled test controller produced: correct
      rendering from a verified identity, evidence chain with QTSP anchor,
      correct deadline, and a drafted (NOT sent) Art. 77 complaint on
      simulated silence.
- [ ] Founder + counsel jointly flip the first `Controller.active` to `true`.
