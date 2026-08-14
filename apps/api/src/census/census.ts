import type { ControllerType, RequestTypeStatutory } from '@scraper/core';
import { DATENANFRAGEN_SNAPSHOT, type DatenanfragenRecord } from './datenanfragen.snapshot.js';

/**
 * The alpha census: the docs/07 + docs/09 controller set, with the user-facing metadata the web UI
 * renders (German B1 labels) and the default statutory instrument per controller.
 *
 * Contact channels are enriched from the datenanfragen.de community database (CC0-1.0) via
 * `tools/census-import` — see `datenanfragen.snapshot.ts` (generated, committed). Enrichment is
 * import-not-activation: community data NEVER overrides the hand-curated fields here, no playbook
 * becomes active because a record exists, and every channel is re-verified by counsel before any
 * real send (docs/07). The snapshot exists so the alpha shows real, sourced contact data and so the
 * production Controller import has a tested transform to start from.
 */
export interface CensusEntry {
  readonly slug: string;
  readonly id: string;
  /** Display name (not a brand asset — plain text). */
  readonly name: string;
  /** German category label, drives the category glyph in the web UI. */
  readonly type: 'Datenhändler' | 'Adress-Broker' | 'Auskunftei' | 'KI-Bewerbungstool';
  readonly risk: 'crit' | 'warn' | 'mut';
  readonly riskLbl: string;
  /** B1 German: what this controller holds about the user. */
  readonly holds: string;
  /** The instrument the UI files by default for this controller. */
  readonly defaultRequestType: RequestTypeStatutory;
  /** Shown on the start screen's preview list. */
  readonly featured: boolean;
}

/**
 * The census's German display label -> the Prisma `ControllerType` the router classifies by.
 *
 * It lives here, next to the labels, because two consumers need the same answer: the DB seed writes
 * `Controller.type`, and the in-memory dev adapter has to report the same classification or the
 * high-harm bypass (ADR-036) would fire in one mode and not the other. An unmapped label reads as
 * unclassified rather than OTHER — see `controllerTypeOf`.
 */
const TYPE_BY_LABEL: Readonly<Record<CensusEntry['type'], ControllerType>> = {
  'Datenhändler': 'DATA_ENRICHMENT_BROKER',
  'Adress-Broker': 'ADDRESS_TRADER',
  'Auskunftei': 'CREDIT_BUREAU',
  'KI-Bewerbungstool': 'AI_SCREENER',
};

/** The ControllerType for a census entry. Never guesses: an unknown label yields null. */
export function controllerTypeOf(entry: Pick<CensusEntry, 'type'>): ControllerType | null {
  return TYPE_BY_LABEL[entry.type] ?? null;
}

export const CENSUS: readonly CensusEntry[] = [
  {
    slug: 'zoominfo', id: 'c_zoominfo', name: 'ZoomInfo', type: 'Datenhändler', risk: 'crit',
    riskLbl: 'Hohes Risiko', holds: 'Ihre berufliche und private E-Mail, Handynummer, Arbeitgeber',
    defaultRequestType: 'ERASURE_ART17', featured: true,
  },
  {
    slug: 'apollo', id: 'c_apollo', name: 'Apollo.io', type: 'Datenhändler', risk: 'crit',
    riskLbl: 'Hohes Risiko', holds: 'E-Mail, Telefonnummer, Position, Werdegang',
    defaultRequestType: 'ERASURE_ART17', featured: true,
  },
  {
    slug: 'az-direct', id: 'c_azdirect', name: 'AZ Direct', type: 'Adress-Broker', risk: 'warn',
    riskLbl: 'Werbung', holds: 'Ihre Anschrift für Werbepost',
    defaultRequestType: 'OBJECTION_ART21', featured: true,
  },
  {
    slug: 'schufa', id: 'c_schufa', name: 'SCHUFA', type: 'Auskunftei', risk: 'warn',
    riskLbl: 'Prüfen', holds: 'Verträge, Zahlungen, Ihren Score',
    defaultRequestType: 'ACCESS_ART15', featured: true,
  },
  {
    slug: 'infoscore', id: 'c_infoscore', name: 'infoscore / Experian', type: 'Auskunftei', risk: 'warn',
    riskLbl: 'Prüfen', holds: 'Anschrift (von AZ Direct), Score',
    defaultRequestType: 'ACCESS_ART15_SOURCE', featured: true,
  },
  {
    slug: 'hirevue', id: 'c_hirevue', name: 'HireVue', type: 'KI-Bewerbungstool', risk: 'mut',
    riskLbl: 'Bald verfügbar', holds: 'Bewertung aus einem Video-Interview',
    defaultRequestType: 'ACCESS_ART15', featured: true,
  },
  // The wider docs/07 / docs/10 §7 set — reachable via the API, not on the start preview.
  {
    slug: 'lusha', id: 'c_lusha', name: 'Lusha', type: 'Datenhändler', risk: 'crit',
    riskLbl: 'Hohes Risiko', holds: 'Kontaktdaten aus gescrapten Profilen',
    defaultRequestType: 'ERASURE_ART17', featured: false,
  },
  {
    slug: 'cognism', id: 'c_cognism', name: 'Cognism', type: 'Datenhändler', risk: 'crit',
    riskLbl: 'Hohes Risiko', holds: 'Beruflich-private Kontaktdaten (KASPR-Mutter)',
    defaultRequestType: 'ERASURE_ART17', featured: false,
  },
  {
    slug: 'peopledatalabs', id: 'c_pdl', name: 'People Data Labs', type: 'Datenhändler', risk: 'crit',
    riskLbl: 'Hohes Risiko', holds: 'Profil aus zusammengekauften Datensätzen',
    defaultRequestType: 'ERASURE_ART17', featured: false,
  },
  {
    slug: 'rocketreach', id: 'c_rr', name: 'RocketReach', type: 'Datenhändler', risk: 'crit',
    riskLbl: 'Hohes Risiko', holds: 'E-Mail und Telefonnummer, gescrapt',
    defaultRequestType: 'ERASURE_ART17', featured: false,
  },
  {
    slug: 'crif', id: 'c_crif', name: 'CRIF', type: 'Auskunftei', risk: 'warn',
    riskLbl: 'Prüfen', holds: 'Bonitätsdaten, zugekaufte Adressdaten',
    defaultRequestType: 'ACCESS_ART15', featured: false,
  },
  {
    slug: 'regis24', id: 'c_regis24', name: 'Regis24', type: 'Auskunftei', risk: 'warn',
    riskLbl: 'Prüfen', holds: 'Identitäts- und Adressdaten (kein Score)',
    defaultRequestType: 'ACCESS_ART15_SOURCE', featured: false,
  },
  {
    slug: 'acxiom', id: 'c_acxiom', name: 'Acxiom', type: 'Adress-Broker', risk: 'warn',
    riskLbl: 'Werbung', holds: 'Marketingprofile und Adressdaten',
    // docs/04 authoring rule: the LEAST-collecting instrument first — for marketing data that is
    // the unconditional Art. 21(2) objection, not erasure (the ERASURE default here inverted it).
    defaultRequestType: 'OBJECTION_ART21', featured: false,
  },
  {
    slug: 'deutsche-post-direkt', id: 'c_dpdirekt', name: 'Deutsche Post Direkt', type: 'Adress-Broker', risk: 'warn',
    riskLbl: 'Werbung', holds: 'Adressdaten für Werbezwecke',
    defaultRequestType: 'OBJECTION_ART21', featured: false,
  },
  {
    slug: 'capaneo', id: 'c_capaneo', name: 'Capaneo (Schober)', type: 'Adress-Broker', risk: 'warn',
    riskLbl: 'Werbung', holds: 'Konsumentenprofile und Adressdaten',
    // Same rule as acxiom above: Art. 21(2) first for marketing data.
    defaultRequestType: 'OBJECTION_ART21', featured: false,
  },
];

export function censusEntry(slug: string): CensusEntry | undefined {
  return CENSUS.find((c) => c.slug === slug);
}

/** The CC0 community record for a census slug, if the snapshot carries one. */
export function datenanfragenRecord(slug: string): DatenanfragenRecord | undefined {
  return DATENANFRAGEN_SNAPSHOT.records[slug];
}
