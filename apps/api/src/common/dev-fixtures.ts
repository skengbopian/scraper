import type { DeliveryProof, MandateSnapshot, Playbook, ProvenanceEntryInput, Timestamper, VerifiedIdentity } from '@scraper/core';

/**
 * DEV/ALPHA fixtures — the simulated tester account.
 *
 * The alpha's job is to let a tester exercise the real engine (routing, guards, state machine,
 * clocks) end to end WITHOUT any real identity verification and WITHOUT any real send. That needs a
 * VERIFIED identity + a live mandate to exist somewhere; this module is that somewhere, behind an
 * explicit opt-in flag.
 *
 * Three hard rules:
 *   1. Nothing here is reachable unless SCRAPER_DEV_FIXTURES=1 — off by default.
 *   2. The flag REFUSES to activate under NODE_ENV=production. A production boot with fixtures on
 *      is a misconfiguration and must die loudly, not serve a fake identity.
 *   3. The fixture identity is the only identity the dev middleware will ever attach. There is no
 *      header or body field that lets a caller choose a different subject — the anti-stalker rule
 *      (CLAUDE.md) holds in dev exactly as in production.
 */
const FIXTURE_SAFE_ENVIRONMENTS: readonly string[] = ['development', 'test'];

export function devFixturesEnabled(): boolean {
  if (process.env.SCRAPER_DEV_FIXTURES !== '1') return false;
  const env = process.env.NODE_ENV;
  // ALLOW-LIST, not a deny-list. Refusing only NODE_ENV=production leaves the fixture identity
  // serving whenever NODE_ENV is unset, "staging", "prod", or misspelled — i.e. exactly the
  // deployments most likely to get it wrong. The pre-audit line learned this the same way (its
  // decision log, D29); ported as a lesson rather than as code in wave 1 (ADR-030).
  if (env === undefined || !FIXTURE_SAFE_ENVIRONMENTS.includes(env)) {
    throw new Error(
      `SCRAPER_DEV_FIXTURES=1 requires NODE_ENV to be one of ${FIXTURE_SAFE_ENVIRONMENTS.join(' | ')} ` +
        `(got ${env === undefined ? 'unset' : `"${env}"`}). Dev fixtures serve a fake VERIFIED identity ` +
        'and a simulated send lifecycle; an unrecognised environment must fail closed, not silently ' +
        'behave like development. Set NODE_ENV=development locally, or unset SCRAPER_DEV_FIXTURES.',
    );
  }
  return true;
}

const NOW = new Date('2026-08-01T00:00:00Z');

/** The standard German sample person (Musterfrau), VERIFIED via a stubbed eID flow. */
export const DEV_USER_ID = 'u_dev_erika';

export const DEV_IDENTITY: VerifiedIdentity = {
  id: 'id_dev_erika',
  userId: DEV_USER_ID,
  status: 'VERIFIED',
  method: 'EID',
  legalName: 'Erika Mustermann',
  dateOfBirth: new Date('1979-03-12T00:00:00Z'),
  addresses: [
    {
      street: 'Heidestraße 17',
      postalCode: '51147',
      city: 'Köln',
      country: 'DE',
      current: true,
      verifiedAt: NOW,
    },
  ],
  verifiedAt: NOW,
  providerRef: 'stub_dev_fixture',
};

/** A live mandate covering all four statutory types, so the LEGAL demo path is reachable. */
export const DEV_MANDATE: MandateSnapshot = {
  id: 'm_dev_erika',
  userId: DEV_USER_ID,
  scope: ['ERASURE_ART17', 'ACCESS_ART15', 'ACCESS_ART15_SOURCE', 'OBJECTION_ART21'],
  signedAt: NOW,
  revokedAt: null,
};

/**
 * (controller, requestType) pairs given a DEMO legal playbook marker so the CREATE_LEGAL branch is
 * reachable in the alpha. This is the mechanism the in-memory seed documents for demos — it does NOT
 * activate any real playbook in playbooks/ (all remain active:false, counsel-gated), and nothing the
 * demo "sends" leaves the process: dispatch is simulated via the dev-only simulate endpoints.
 */
export const DEV_DEMO_PLAYBOOK_PAIRS: readonly {
  readonly controllerSlug: string;
  readonly requestType: MandateSnapshot['scope'][number];
}[] = [
  { controllerSlug: 'az-direct', requestType: 'OBJECTION_ART21' },
  // A Datenkopie at the broker itself, distinct from the objection above. Added in port wave 5: a
  // (controller, requestType) triple holds one non-terminal request at a time (ADR-013), so with
  // only one az-direct pair the alpha could demonstrate the objection lifecycle or the access
  // lifecycle, but never both in one session.
  { controllerSlug: 'az-direct', requestType: 'ACCESS_ART15' },
  { controllerSlug: 'schufa', requestType: 'ACCESS_ART15' },
  { controllerSlug: 'infoscore', requestType: 'ACCESS_ART15_SOURCE' },
  { controllerSlug: 'regis24', requestType: 'ACCESS_ART15_SOURCE' },
  // The last link of the Provenance chain (ADR-036, port wave 4). Without this pair the alpha can ask
  // infoscore where the data came from and then do nothing with the answer — which is exactly the
  // dead end wave 4 exists to close.
  { controllerSlug: 'infoscore', requestType: 'ERASURE_ART17' },
];

/**
 * The simulated bureau answer to an Art. 15(1)(g) request. Two categories attributed to a watchlisted
 * broker and one to a genuine contract partner, so the bounded Art. 17(1)(d) demand the chain produces
 * is visibly NARROWER than the file — which is the whole legal point (docs/07).
 *
 * This is a stand-in for parser output, and it is treated as exactly that: nothing here is trusted as a
 * source name. `deriveErasureScope` re-derives the source from the playbook's own counsel-authored
 * watchlist and refuses anything that is not on it.
 */
export const DEV_PROVENANCE_ANSWER: readonly ProvenanceEntryInput[] = Object.freeze([
  { dataCategory: 'Anschriftendaten', statedSource: 'AZ Direct GmbH', statedLegalBasis: 'Art. 6 Abs. 1 lit. f DS-GVO', confidence: 0.94 },
  { dataCategory: 'Umzugsdaten', statedSource: 'AZ Direct GmbH', statedLegalBasis: 'Art. 6 Abs. 1 lit. f DS-GVO', confidence: 0.91 },
  { dataCategory: 'Vertragsdaten', statedSource: 'Sparkasse Köln-Bonn', statedLegalBasis: 'Art. 6 Abs. 1 lit. b DS-GVO', confidence: 0.97 },
]);

/**
 * The watchlist the alpha classifies that answer against.
 *
 * It MIRRORS `playbooks/provenance.infoscore.yaml`, and the mirror is guarded rather than trusted:
 * `packages/core/test/erasure-scope.test.ts` reads the YAML and fails if the two drift. The API does
 * not parse `playbooks/` at runtime (no YAML dependency in a production app for a dev fixture), so
 * this is the seam where a copy is unavoidable — a checked copy rather than a quiet one.
 */
export const DEV_PROVENANCE_PLAYBOOK: Playbook = Object.freeze({
  slug: 'provenance.infoscore',
  kind: 'RIGHTS_REQUEST',
  controller: 'infoscore',
  requestType: 'ACCESS_ART15_SOURCE',
  version: 1,
  active: false,
  channel: { primary: 'postal', fallback: 'web_form', registered: { primary: true, fallback: false } },
  recipient: { postal: 'infoscore Consumer Data GmbH, Abteilung Datenschutz, Rheinstraße 99, 76532 Baden-Baden' },
  template: 'art15g-herkunft.de',
  subjectFields: ['legalName', 'dateOfBirth', 'addresses'],
  provenance: {
    extractPerCategory: true,
    brokerWatchlist: ['az-direct', 'acxiom', 'deutsche-post-direkt', 'schober', 'capaneo'],
    expectSource: 'az-direct',
    flagIf: { incompleteSourceList: true, contradictsArt14: true },
  },
  validation: { compliedIf: { anyOf: [{ 'structured.sourcesNamedPerCategory': true }] }, humanReviewIfConfidenceBelow: 0.8 },
} as Playbook);

// ------------------------------------------------------------------------------------------------
// The simulated "registered send" (port wave 5, ADR-037)
// ------------------------------------------------------------------------------------------------

/**
 * A timestamper with no QTSP behind it.
 *
 * It returns `kind: 'SIMULATED'` and says why. That is the entire point: the pre-audit line's
 * equivalent returned something indistinguishable from a real anchor, and this line keys the
 * statutory clock off exactly that distinction. `provableSendEvidenceIdOf()` refuses this anchor, so
 * the alpha's "registered send" fails closed to the human queue instead of inventing a legal
 * deadline (CLAUDE.md §6, ADR-012).
 */
export const SIMULATED_TIMESTAMPER: Timestamper = {
  async anchor(sha256Hex: string) {
    return {
      kind: 'SIMULATED' as const,
      tsaRef: `sim:${sha256Hex.slice(0, 16)}`,
      signedAt: new Date(),
      algorithm: 'SHA-256',
      reason: 'no QTSP account is configured — a dev timestamper cannot establish legal time',
    };
  },
};

/**
 * The receipt a stubbed hybrid-mail account "returns" for a registered send.
 *
 * `origin: 'SIMULATED'` is not decoration. The pre-audit line's stub returned
 * `proofRef: 'stub:einwurf-proof-N'` — receipt-shaped, carrier-indistinguishable — for any
 * `registered: true` call. Here a proof object is one of the two things that authorise the Art.
 * 12(3) clock, so the provider has to declare that no carrier issued it.
 */
export function simulatedDeliveryProof(requestId: string): DeliveryProof {
  return {
    kind: 'EINWURF_EINSCHREIBEN',
    trackingRef: `sim-einwurf-${requestId}`,
    deliveredAt: new Date(),
    origin: 'SIMULATED',
  };
}
