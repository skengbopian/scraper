import type { Playbook } from '../playbook/types.js';

/**
 * The Provenance flagship (docs/09): force each bureau to name where it got each data category, then
 * decide what follow-ups a human may be offered.
 *
 * The hard rule in here: **parser output may not trigger an irreversible action** (CLAUDE.md §2).
 * Every broker named in a bureau's reply is a candidate for a new outbound legal request. That is an
 * irreversible act. So this module produces DRAFT PROPOSALS with a required-human-confirmation flag;
 * it never returns something a caller can hand straight to a dispatcher.
 */

export interface ProvenanceEntryInput {
  readonly dataCategory: string;
  readonly statedSource: string | null;
  readonly statedLegalBasis: string | null;
  readonly confidence: number;
}

export interface ProvenanceEntry extends ProvenanceEntryInput {
  readonly isBroker: boolean;
  readonly matchedWatchlistSlug: string | null;
}

/** Normalise a free-text company name enough to compare it with a census slug. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(gmbh|ag|kg|se|mbh|co|deutschland|holding|&)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Match a stated source against the playbook's brokerWatchlist.
 *
 * Deliberately conservative: a token-containment match, not a fuzzy score. A false positive here
 * proposes a legal request against a company that was never named, which is a worse failure than
 * missing one — the human reviewing the proposal has the bureau's letter in front of them.
 */
export function matchBroker(statedSource: string | null, watchlist: readonly string[]): string | null {
  if (!statedSource) return null;
  const hay = normalise(statedSource);
  const hayTokens = new Set(hay.split(' ').filter(Boolean));
  for (const slug of watchlist) {
    const needleTokens = normalise(slug.replace(/-/g, ' ')).split(' ').filter(Boolean);
    if (needleTokens.length && needleTokens.every((t) => hayTokens.has(t))) return slug;
  }
  return null;
}

export function buildEntries(
  raw: readonly ProvenanceEntryInput[],
  pb: Playbook,
): readonly ProvenanceEntry[] {
  const watchlist = pb.provenance?.brokerWatchlist ?? [];
  return raw.map((e) => {
    const slug = matchBroker(e.statedSource, watchlist);
    return { ...e, isBroker: slug !== null, matchedWatchlistSlug: slug };
  });
}

export type SourceListVerdict =
  | { readonly kind: 'COMPLETE' }
  | { readonly kind: 'INCOMPLETE'; readonly missingCategories: readonly string[] }
  | { readonly kind: 'CONTRADICTS_ART14'; readonly expectedSource: string };

/**
 * Is the answer materially incomplete?
 *
 * A category the controller admits holding but names no source for is the BayLDA "incomplete Art. 15
 * answer is itself a violation" case. It is INCOMPLETE, never REFUSED — recording it as a refusal
 * corrupts the per-controller statistics docs/02 calls the moat (state machine, invariant 6).
 */
export function assessSourceList(
  entries: readonly ProvenanceEntry[],
  pb: Playbook,
): SourceListVerdict {
  const missing = entries.filter((e) => !e.statedSource || e.statedSource.trim() === '').map((e) => e.dataCategory);
  if (pb.provenance?.flagIf?.incompleteSourceList && missing.length > 0) {
    return { kind: 'INCOMPLETE', missingCategories: missing };
  }
  // The bureau's own Art. 14 notice names a source; the answer denies it. That contradiction is the
  // strongest Art. 77 material the flagship produces.
  const expected = pb.provenance?.expectSource;
  if (pb.provenance?.flagIf?.contradictsArt14 && expected) {
    const named = entries.some((e) => e.matchedWatchlistSlug === expected);
    if (!named) return { kind: 'CONTRADICTS_ART14', expectedSource: expected };
  }
  if (missing.length > 0) return { kind: 'INCOMPLETE', missingCategories: missing };
  return { kind: 'COMPLETE' };
}

export interface FollowUpProposal {
  readonly requestType: 'ERASURE_ART17' | 'OBJECTION_ART21';
  readonly targetControllerSlug: string;
  readonly cause: 'PROVENANCE_CHAIN';
  readonly rationale: string;
  /**
   * Always true. Present as a field rather than an implicit rule so that any code path that
   * dispatches a proposal has to read it, and so a test can assert it for every proposal produced.
   */
  readonly requiresHumanConfirmation: true;
}

/**
 * Chained follow-ups when a broker is named (docs/09).
 *
 * Returns PROPOSALS. Nothing here sends, and nothing here creates a RightsRequest — the caller must
 * put these in front of a human first.
 */
export function proposeFollowUps(
  entries: readonly ProvenanceEntry[],
  bureauSlug: string,
): readonly FollowUpProposal[] {
  const brokers = [...new Set(entries.filter((e) => e.isBroker).map((e) => e.matchedWatchlistSlug!))];
  const out: FollowUpProposal[] = [];
  for (const broker of brokers) {
    const categories = entries
      .filter((e) => e.matchedWatchlistSlug === broker)
      .map((e) => e.dataCategory)
      .join(', ');
    out.push({
      requestType: 'ERASURE_ART17',
      targetControllerSlug: bureauSlug,
      cause: 'PROVENANCE_CHAIN',
      rationale:
        `${bureauSlug} named ${broker} as the source of: ${categories}. Art. 17(1)(d) unlawful-origin ` +
        `chain — erasure of the broker-sourced layer at the bureau, NOT the whole file.`,
      requiresHumanConfirmation: true,
    });
    out.push({
      requestType: 'OBJECTION_ART21',
      targetControllerSlug: broker,
      cause: 'PROVENANCE_CHAIN',
      rationale: `${broker} was named by ${bureauSlug} as a data source. Art. 21(2) objection at the broker.`,
      requiresHumanConfirmation: true,
    });
    out.push({
      requestType: 'ERASURE_ART17',
      targetControllerSlug: broker,
      cause: 'PROVENANCE_CHAIN',
      rationale: `${broker} was named by ${bureauSlug} as a data source. Art. 17(1) erasure at the broker.`,
      requiresHumanConfirmation: true,
    });
  }
  return out;
}
