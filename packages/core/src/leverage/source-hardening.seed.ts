/**
 * Seed: source-hardening self-serve routes (docs/10 §7.7 target #5, the SAFE part).
 *
 * Enrichment brokers re-scrape LinkedIn/Xing, so a removal re-lists (docs/10 §7.3). The cheapest,
 * compounding prevention is the user tightening their OWN profile visibility and data-sharing settings
 * so there is less to re-scrape. These are login-gated GUIDED HANDOFFS — the user acts in their own
 * session; we never store their credentials (docs/08 guardrail 1). routeType CONSENT_WITHDRAWAL: the
 * user withdraws the platform's sharing of their profile with partners / public visibility.
 *
 * NOT built (gated behind OQ-18): the self-exposure SCAN (docs/10 §7.5) — a "what would a background
 * checker find on you" discovery scan is dual-use (arbitrary-subject profiling) and must be bound to the
 * verified account holder under a safety design before it ships. Source-hardening is self-only and safe;
 * the scanner is not, and is deliberately absent here.
 */
import type { SelfServeRoute } from './self-serve.js';

const LINKEDIN_STEPS: readonly string[] = Object.freeze([
  'Öffnen Sie die LinkedIn-Datenschutzeinstellungen (Link unten) — in IHREM eingeloggten Konto.',
  'Setzen Sie „Profil-Sichtbarkeit außerhalb von LinkedIn" auf Aus.',
  'Deaktivieren Sie „Daten für personalisierte Werbung" und die Weitergabe an Partner/Dritte.',
  'Beschränken Sie „Wer kann Ihre Verbindungen sehen" und die öffentliche Profil-Sichtbarkeit.',
  'Speichern. Scraper speichert keine Zugangsdaten — Sie handeln in Ihrer eigenen Sitzung.',
]);

const XING_STEPS: readonly string[] = Object.freeze([
  'Öffnen Sie die XING-Privatsphäre-Einstellungen (Link unten) — in IHREM eingeloggten Konto.',
  'Beschränken Sie die Sichtbarkeit Ihres Profils für Nicht-Mitglieder und Suchmaschinen.',
  'Deaktivieren Sie die Weitergabe Ihrer Daten zu Werbe-/Partnerzwecken.',
  'Speichern. Scraper speichert keine Zugangsdaten — Sie handeln in Ihrer eigenen Sitzung.',
]);

/** Prevention routes: login-gated, so guided-only (requiresLogin: true). Not triggered by a request
 *  outcome — surfaced in a "harden your sources" flow the user runs proactively. */
export const SOURCE_HARDENING_ROUTES: readonly SelfServeRoute[] = Object.freeze(
  ([
    {
      companySlug: 'linkedin',
      routeType: 'CONSENT_WITHDRAWAL',
      url: 'https://www.linkedin.com/mypreferences/d/categories/privacy',
      steps: LINKEDIN_STEPS,
      requiresLogin: true,
      estMinutes: 8,
      lastVerifiedAt: '2026-08-10',
      verificationMethod: 'source-hardening seed 2026-08-10 (settings paths shift; re-verify on drift)',
    },
    {
      companySlug: 'xing',
      routeType: 'CONSENT_WITHDRAWAL',
      url: 'https://www.xing.com/settings/privacy',
      steps: XING_STEPS,
      requiresLogin: true,
      estMinutes: 6,
      lastVerifiedAt: '2026-08-10',
      verificationMethod: 'source-hardening seed 2026-08-10',
    },
  ] satisfies SelfServeRoute[]).map((r) => Object.freeze(r)),
);
