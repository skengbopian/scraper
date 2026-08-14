import type { VerifiedIdentity } from '../identity/subject.js';

/**
 * The BYO-upload identity-match gate (docs/10 §3.1 — "same class as IdentityPacket").
 *
 * An uploaded Datenkopie is ingested ONLY when the parsed subject (name + date of birth) matches the
 * caller's VERIFIED identity. Mismatch → reject and purge, never "ingest anyway": this is what keeps
 * the upload endpoint from becoming a third-party-file ingest path (CLAUDE.md, the one rule).
 *
 * v1 policy is deliberately CONSERVATIVE — exact date-of-birth equality plus normalised full-name
 * equality (case, umlauts/ß, punctuation, academic titles and multiple spaces folded). No fuzzy
 * distance: a false accept here is a safety failure, a false reject is a support ticket.
 * TODO(safety): OQ-15 owns the final thresholds, the mismatch-retention policy (immediate purge is
 * implemented) and the appeal path.
 */
export interface ParsedSubject {
  readonly name: string;
  readonly dateOfBirth: Date | null;
}

export type IdentityMatch = { readonly match: true } | { readonly match: false; readonly reason: string };

const TITLES = /\b(dr|prof|dipl[.\-\w]*|mag|ba|ma|msc|bsc)\b\.?/g;

export function normalizeName(name: string): string {
  return name
    // NFC FIRST: a decomposed "Müller" (u + combining diaeresis, common in PDF text extraction)
    // otherwise misses the literal `ü` replace below and folds to "muller" vs "mueller" — a false
    // REJECT of the account holder's own document (audit W15).
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(TITLES, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/[-\s]+/g, ' ')
    .trim();
}

export function matchSubjectToIdentity(parsed: ParsedSubject, identity: VerifiedIdentity): IdentityMatch {
  if (identity.status !== 'VERIFIED') return { match: false, reason: 'identity is not VERIFIED' };
  if (!parsed.name.trim()) return { match: false, reason: 'document names no subject' };
  // Invalid Date guards the toISOString below: a parser bug or hostile shape must be a clean
  // "unreadable", never a RangeError that 500s the upload (audit W15).
  if (!parsed.dateOfBirth || Number.isNaN(parsed.dateOfBirth.getTime())) {
    return { match: false, reason: 'document carries no readable date of birth' };
  }

  const dobParsed = parsed.dateOfBirth.toISOString().slice(0, 10);
  const dobIdentity = identity.dateOfBirth.toISOString().slice(0, 10);
  if (dobParsed !== dobIdentity) return { match: false, reason: 'date of birth does not match the verified identity' };

  if (normalizeName(parsed.name) !== normalizeName(identity.legalName)) {
    return { match: false, reason: 'name does not match the verified identity' };
  }
  return { match: true };
}
