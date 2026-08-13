/**
 * The scope of an Art. 17(1)(d) PARTIAL erasure at a bureau — the last link of the Provenance chain.
 *
 * `templates/art17-loeschung-herkunft.de.md` demands the erasure of "ausschließlich der folgenden
 * Datenkategorien" and then lists them. Those categories and the source that supplied them are not
 * identity fields, so `subjectFields` cannot carry them: they are facts the CONTROLLER stated in its
 * own Art. 15(1)(g) answer. This module is the only way to turn those facts into renderable values,
 * and it exists because the two obvious ways of doing it are both wrong:
 *
 *  1. **Rendering without them.** `render()` treats an `{{#each}}` over an unsupplied list as empty,
 *     so the letter goes out announcing a bounded demand and listing nothing — an unbounded erasure
 *     demand at a credit bureau, which `docs/07` rules out, arriving silently. Hence the brand: a
 *     playbook that declares `scopeSource` cannot be rendered without a scope object that only this
 *     module can construct.
 *  2. **Passing the controller's own words through.** Every value here originates in parser output of
 *     a hostile document (CLAUDE.md §2, docs/06 C4). The SOURCE names are therefore never free text
 *     from the reply — they are re-derived from the counsel-authored `brokerWatchlist` of the
 *     provenance playbook that asked the question, and a slug that is not on that list is refused.
 *     The category labels are the one thing that must come from the reply, so they are sanitised
 *     against a closed character/length/count budget, and anything outside it REFUSES rather than
 *     being quietly dropped — a silently narrowed demand is a legal defect the user cannot see.
 *
 * Nothing here sends, and constructing a scope is not authorisation to send: `proposeFollowUps()`
 * still returns proposals a human must confirm.
 */
import type { Playbook } from '../playbook/types.js';
import type { ProvenanceEntry } from './ledger.js';

/**
 * Module-private and never exported, exactly as `RequestSubject`'s brand is (see identity/subject.ts).
 * A real symbol rather than a `declare const`, so the brand survives to runtime and a value that
 * crossed a queue or a JSON boundary can be re-checked before it reaches a letter.
 */
const SCOPE_BRAND: unique symbol = Symbol('scraper.PartialErasureScope');

/** The only value `renderRequest` accepts for a `scopeSource: PROVENANCE_ANSWER` playbook. */
export interface PartialErasureScope {
  readonly [SCOPE_BRAND]: true;
  /** The controller whose OWN answer named the source. The erasure may only be demanded here. */
  readonly bureauSlug: string;
  /** The ACCESS_ART15_SOURCE playbook whose answer produced these entries. */
  readonly sourcePlaybookSlug: string;
  /** Sanitised, deduplicated, order-preserving category labels. Never empty. */
  readonly categories: readonly string[];
  /** Watchlist slugs, re-validated against the source playbook's brokerWatchlist. Never empty. */
  readonly sourceSlugs: readonly string[];
  /** Display names for the letter, one per `sourceSlugs` entry, in the same order. */
  readonly sourceNames: readonly string[];
}

export class ErasureScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErasureScopeError';
  }
}

/**
 * The budget a category label must fit to be stateable in a legal letter. These are not style rules:
 * a 4000-character "category" or one carrying newlines produces a letter no bureau can action, and
 * template syntax inside a value would be re-expanded by the renderer's final pass.
 */
export const MAX_CATEGORY_LENGTH = 120;
export const MAX_CATEGORIES = 24;

// C0/C1 controls (which includes \n and \r) plus the Unicode line/paragraph separators. Written as
// escapes on purpose: a literal control character in this source would be invisible to a reviewer.
const CONTROL_OR_SEPARATOR = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

/**
 * Normalise one label. Returns the cleaned string, or throws — never returns null. Dropping a
 * malformed category would narrow the demand behind the user's back; refusing routes the whole
 * follow-up to a human, which is the correct destination for a reply we could not read cleanly.
 */
function cleanCategory(raw: string, where: string): string {
  if (CONTROL_OR_SEPARATOR.test(raw)) {
    throw new ErasureScopeError(
      `${where}: the category label contains a control or line-separator character. A category taken ` +
        `from a controller's reply must be a single plain line before it can be stated in a letter.`,
    );
  }
  if (raw.includes('{{') || raw.includes('}}')) {
    throw new ErasureScopeError(
      `${where}: the category label contains template syntax ("{{" or "}}"). Values derived from a ` +
        `controller's reply may not carry renderer constructs (docs/06 C4).`,
    );
  }
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (cleaned === '') {
    throw new ErasureScopeError(`${where}: the category label is empty after normalisation.`);
  }
  if (cleaned.length > MAX_CATEGORY_LENGTH) {
    throw new ErasureScopeError(
      `${where}: the category label is ${cleaned.length} characters, over the ${MAX_CATEGORY_LENGTH} ` +
        `budget. Refusing to state it rather than truncating a legal demand.`,
    );
  }
  return cleaned;
}

export interface DeriveErasureScopeInput {
  /** Entries from the bureau's Art. 15(1)(g) answer, already matched by `buildEntries`. */
  readonly entries: readonly ProvenanceEntry[];
  /** The ACCESS_ART15_SOURCE playbook that asked the question — the watchlist authority. */
  readonly sourcePlaybook: Playbook;
  /** The controller that answered. Must be the erasure target. */
  readonly bureauSlug: string;
  /**
   * Optional slug -> legal name map (the census). A slug with no entry renders as the slug itself,
   * which is ugly but true; an entry that is not a clean single line is refused, same budget as a
   * category, because it lands in the same letter.
   */
  readonly displayNames?: Readonly<Record<string, string>>;
}

/**
 * The ONLY constructor for a `PartialErasureScope`.
 *
 * Refuses (rather than returning an empty or partial scope) when: no entry names a watchlisted
 * broker; a matched slug is not on the source playbook's watchlist; the source playbook declares no
 * watchlist at all; or any label fails the budget above.
 */
export function deriveErasureScope(input: DeriveErasureScopeInput): PartialErasureScope {
  const pb = input.sourcePlaybook;
  if (pb.requestType !== 'ACCESS_ART15_SOURCE') {
    throw new ErasureScopeError(
      `sourcePlaybook "${pb.slug}" is ${pb.requestType}, not ACCESS_ART15_SOURCE. Only a provenance ` +
        `answer can bound an Art. 17(1)(d) partial erasure — that chain is what makes the demand ` +
        `evidenced rather than speculative (docs/09).`,
    );
  }
  const watchlist = pb.provenance?.brokerWatchlist ?? [];
  if (watchlist.length === 0) {
    throw new ErasureScopeError(
      `sourcePlaybook "${pb.slug}" declares no provenance.brokerWatchlist, so there is no closed set ` +
        `to validate a named source against. Refusing to lift a source name out of the reply text.`,
    );
  }
  const allowed = new Set(watchlist);

  const brokerEntries = input.entries.filter((e) => e.isBroker && e.matchedWatchlistSlug !== null);
  if (brokerEntries.length === 0) {
    throw new ErasureScopeError(
      `no entry in this answer names a watchlisted broker, so there is no unlawful-origin layer to ` +
        `demand the erasure of. An Art. 17(1)(d) letter with an empty category list would be an ` +
        `unbounded erasure demand at a bureau (docs/07).`,
    );
  }

  const categories: string[] = [];
  const seenCategory = new Set<string>();
  const sourceSlugs: string[] = [];
  const sourceNames: string[] = [];
  const seenSlug = new Set<string>();

  for (const [i, e] of brokerEntries.entries()) {
    const slug = e.matchedWatchlistSlug!;
    if (!allowed.has(slug)) {
      throw new ErasureScopeError(
        `entry ${i} matched source "${slug}", which is not on ${pb.slug}'s brokerWatchlist. A source ` +
          `name reaching a letter must come from the counsel-authored watchlist, never from the reply.`,
      );
    }
    const cleaned = cleanCategory(e.dataCategory, `entry ${i} (source ${slug})`);
    if (!seenCategory.has(cleaned)) {
      seenCategory.add(cleaned);
      categories.push(cleaned);
    }
    if (!seenSlug.has(slug)) {
      seenSlug.add(slug);
      sourceSlugs.push(slug);
      sourceNames.push(cleanCategory(input.displayNames?.[slug] ?? slug, `display name for "${slug}"`));
    }
  }

  if (categories.length > MAX_CATEGORIES) {
    throw new ErasureScopeError(
      `${categories.length} distinct categories, over the ${MAX_CATEGORIES} budget. A demand this ` +
        `broad is no longer the bounded instrument docs/07 permits against a bureau — route it to a ` +
        `human instead of sending it.`,
    );
  }

  return Object.freeze({
    [SCOPE_BRAND]: true,
    bureauSlug: input.bureauSlug,
    sourcePlaybookSlug: pb.slug,
    categories: Object.freeze(categories),
    sourceSlugs: Object.freeze(sourceSlugs),
    sourceNames: Object.freeze(sourceNames),
  }) as PartialErasureScope;
}

/** Runtime check that a value really came from `deriveErasureScope` (types are erased at runtime). */
export function isPartialErasureScope(v: unknown): v is PartialErasureScope {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[SCOPE_BRAND] === true;
}
