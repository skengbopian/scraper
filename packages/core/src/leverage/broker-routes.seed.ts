/**
 * Seed: verified Tier-1 self-serve removal routes for the docs/10 §7 enrichment-broker layer.
 *
 * Every route below is a genuine GDPR erasure form (not a mere US "do not sell" suppression), reached
 * without an account login and verified by an email code — so it is the cheapest, primary removal rung
 * (chooseCheapestRung prefers it over a legal request). The legal Art. 17 letter is the escalation.
 *
 * Verified 2026-08-09. URLs re-check on a schedule (docs/08 §2): these brokers change endpoints, and a
 * dead link starts nothing. `lastVerifiedAt` is that check's timestamp, not a freshness guarantee.
 *
 * GUARDRAIL: no route requires login and none carries a credential — a login-gated route would stay a
 * guided handoff (docs/08 guardrail 1). `broker-routes.seed.test.ts` asserts both.
 */
import type { SelfServeRoute } from './self-serve.js';

/** The enrichment brokers docs/10 §7.7 ranks as removal target #1. Kept in sync with the seed below. */
export const TARGET_ENRICHMENT_BROKERS: readonly string[] = Object.freeze([
  'zoominfo',
  'apollo',
  'lusha',
  'cognism',
  'peopledatalabs',
  'rocketreach',
]);

// NOTE(safety) — step 2 has the user type the professional email under which the broker holds them into
// the broker's OWN opt-out page during a guided handoff. That email is free-typed by the user, not
// derived from the verified Identity; what keeps this self-only (not a third-party targeting vector) is
// the broker's email-confirmation-code loop. Scraper must never store or transmit that email. If a future
// change captures it, it becomes the OQ-19 "email as a subject-identifier" question — route it there.
const REMOVAL_STEPS: readonly string[] = Object.freeze([
  'Öffnen Sie die Opt-out-Seite (Link unten).',
  'Geben Sie die berufliche E-Mail-Adresse ein, unter der Sie geführt werden, und fordern Sie den Bestätigungscode an.',
  'Geben Sie den per E-Mail erhaltenen Code ein.',
  'Wählen Sie „Daten löschen/entfernen" und bestätigen Sie die Anfrage.',
  'Bewahren Sie die Bestätigung auf (Screenshot) — Scraper legt sie als Nachweis ab.',
  'Nach ~2–4 Wochen erneut prüfen: diese Anbieter tragen Daten oft wieder ein (Reappearance).',
]);

/**
 * All routes: DSR_ERASURE, no login, ~10 minutes. `successRate` is intentionally omitted until we have
 * observed outcomes — a fabricated rate would corrupt the cheapest-rung ranking.
 */
export const ENRICHMENT_BROKER_ROUTES: readonly SelfServeRoute[] = Object.freeze(
  ([
  {
    companySlug: 'zoominfo',
    routeType: 'DSR_ERASURE',
    url: 'https://www.zoominfo.com/update/remove',
    steps: REMOVAL_STEPS,
    requiresLogin: false,
    estMinutes: 10,
    lastVerifiedAt: '2026-08-09',
    verificationMethod: 'workflow web-research 2026-08-09 (live page returns 403 to server fetch — URL corroborated across guides; re-verify in browser)',
  },
  {
    companySlug: 'apollo',
    routeType: 'DSR_ERASURE',
    url: 'https://www.apollo.io/privacy-policy/remove',
    steps: REMOVAL_STEPS,
    requiresLogin: false,
    estMinutes: 10,
    lastVerifiedAt: '2026-08-09',
    verificationMethod: 'workflow web-research 2026-08-09 — also demand suppression-list add via privacy@apollo.io',
  },
  {
    companySlug: 'lusha',
    routeType: 'DSR_ERASURE',
    url: 'https://www.lusha.com/privacy-center/request-removal/',
    steps: REMOVAL_STEPS,
    requiresLogin: false,
    estMinutes: 10,
    lastVerifiedAt: '2026-08-09',
    verificationMethod: 'workflow web-research 2026-08-09',
  },
  {
    companySlug: 'cognism',
    routeType: 'DSR_ERASURE',
    url: 'https://cognism.privacy.saymine.io/cognism',
    steps: REMOVAL_STEPS,
    requiresLogin: false,
    estMinutes: 10,
    lastVerifiedAt: '2026-08-09',
    verificationMethod: 'workflow web-research 2026-08-09 (saymine-hosted privacy portal)',
  },
  {
    companySlug: 'peopledatalabs',
    routeType: 'DSR_ERASURE',
    url: 'https://privacy.peopledatalabs.com/',
    steps: REMOVAL_STEPS,
    requiresLogin: false,
    estMinutes: 10,
    lastVerifiedAt: '2026-08-09',
    verificationMethod: 'workflow web-research 2026-08-09 — 72h confirm-link window, ~14-day deletion',
  },
  {
    companySlug: 'rocketreach',
    routeType: 'DSR_ERASURE',
    url: 'https://rocketreach.co/remove-profile',
    steps: REMOVAL_STEPS,
    requiresLogin: false,
    estMinutes: 10,
    lastVerifiedAt: '2026-08-09',
    verificationMethod: 'workflow web-research 2026-08-09',
  },
  ] satisfies SelfServeRoute[]).map((r) => Object.freeze(r)),
);
