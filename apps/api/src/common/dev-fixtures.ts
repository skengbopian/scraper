import type { VerifiedIdentity } from '@scraper/core';
import type { MandateSnapshot } from '@scraper/core';

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
export function devFixturesEnabled(): boolean {
  if (process.env.SCRAPER_DEV_FIXTURES !== '1') return false;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SCRAPER_DEV_FIXTURES=1 with NODE_ENV=production — dev fixtures serve a fake VERIFIED identity ' +
        'and simulated transitions, which must never run in production. Unset one of the two.',
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
  { controllerSlug: 'schufa', requestType: 'ACCESS_ART15' },
  { controllerSlug: 'infoscore', requestType: 'ACCESS_ART15_SOURCE' },
  { controllerSlug: 'regis24', requestType: 'ACCESS_ART15_SOURCE' },
];
