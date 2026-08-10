/**
 * THE RULE THAT OUTRANKS ALL OTHERS (CLAUDE.md).
 *
 * "Look up what a data controller holds about a person, then act on it" is also exactly how a stalker
 * locates a victim. The only thing separating this product from that one is that a request's subject
 * can ONLY ever be the authenticated, identity-verified account holder.
 *
 * That is enforced here structurally, not by convention:
 *
 *  1. `RequestSubject` carries a brand keyed to a `unique symbol` that is declared but NEVER exported.
 *     No code outside this module can produce a value assignable to the type — an object literal with
 *     the right fields will not type-check. There is no `{ legalName: 'someone else' }` path.
 *  2. `deriveSubject()` is the only constructor, it takes a whole `VerifiedIdentity`, and it throws
 *     unless `status === 'VERIFIED'`.
 *  3. The result carries `identityId` and `verifiedAt` so downstream code can re-assert provenance at
 *     the point of send rather than trusting a value it was handed.
 *
 * If you are about to add a function here that accepts a name, DOB or address as an argument: stop.
 * That is the feature CLAUDE.md says to flag rather than build.
 */

/**
 * A real, module-private symbol — NOT `declare const`, which would exist only in the type system and
 * leave nothing to brand the value with at runtime. Because it is never exported, no other module can
 * name this key, so `RequestSubject` is unforgeable at compile time; because it is a real symbol, the
 * brand is also present at runtime and `isRequestSubject()` can check it at the send boundary.
 */
const SUBJECT_BRAND: unique symbol = Symbol('scraper.RequestSubject');

export type IdentityStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'EXPIRED';

export interface PostalAddress {
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly country: string;
  /** Historical addresses still belong to the verified person and are lawful to cite in an Art. 15. */
  readonly current: boolean;
  readonly verifiedAt: Date;
}

export interface VerifiedIdentity {
  readonly id: string;
  readonly userId: string;
  readonly status: IdentityStatus;
  readonly method: 'BANK_IDENT' | 'EID';
  readonly legalName: string;
  readonly dateOfBirth: Date;
  readonly addresses: readonly PostalAddress[];
  readonly verifiedAt: Date | null;
  readonly providerRef: string | null;
}

/** The closed set of identity fields a template may ever require. Mirrors the playbook schema enum. */
export const SUBJECT_FIELDS = ['legalName', 'dateOfBirth', 'addresses'] as const;
export type SubjectField = (typeof SUBJECT_FIELDS)[number];

export interface RequestSubject {
  /** Unforgeable outside this module — see the file header. */
  readonly [SUBJECT_BRAND]: true;
  readonly identityId: string;
  readonly userId: string;
  readonly verifiedAt: Date;
  readonly legalName: string;
  readonly dateOfBirth: Date;
  readonly primaryAddress: PostalAddress;
  readonly additionalAddresses: readonly PostalAddress[];
}

export class IdentityNotVerifiedError extends Error {
  constructor(public readonly identityId: string, public readonly status: IdentityStatus) {
    super(
      `Identity ${identityId} has status ${status}, not VERIFIED. A rights request may not be created, ` +
        `rendered or sent for an unverified identity (CLAUDE.md §1, docs/06 C1).`,
    );
    this.name = 'IdentityNotVerifiedError';
  }
}

/**
 * The ONLY way to obtain a `RequestSubject`. Every subject identifier on every outbound request
 * traces back through here to a provider-verified identity record.
 */
export function deriveSubject(identity: VerifiedIdentity): RequestSubject {
  if (identity.status !== 'VERIFIED' || identity.verifiedAt === null) {
    throw new IdentityNotVerifiedError(identity.id, identity.status);
  }
  const current = identity.addresses.filter((a) => a.current);
  if (current.length !== 1) {
    // Not pedantry: the letters render exactly one "Anschrift" line. Zero means an empty field goes
    // out in a legal document; more than one means the renderer picks arbitrarily.
    throw new Error(
      `Identity ${identity.id} has ${current.length} current addresses; exactly one is required to ` +
        `render a request. Historical addresses belong in additionalAddresses.`,
    );
  }
  return Object.freeze({
    [SUBJECT_BRAND]: true,
    identityId: identity.id,
    userId: identity.userId,
    verifiedAt: identity.verifiedAt,
    legalName: identity.legalName,
    dateOfBirth: identity.dateOfBirth,
    primaryAddress: current[0]!,
    additionalAddresses: Object.freeze(identity.addresses.filter((a) => !a.current)),
  }) as RequestSubject;
}

/**
 * Runtime check that a value really came from `deriveSubject`. Types are erased at runtime, so a
 * value crossing a queue, a cache or a JSON boundary can claim to be a RequestSubject without being
 * one. Anything that deserialises a subject must re-check here.
 */
export function isRequestSubject(v: unknown): v is RequestSubject {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[SUBJECT_BRAND] === true;
}

/**
 * Re-assert at the send boundary that this subject belongs to the user we are acting for. Cheap, and
 * it catches the class of bug where a subject is threaded through a queue or a cache and ends up
 * paired with the wrong request.
 */
export function assertSubjectBelongsTo(subject: RequestSubject, userId: string, identityId: string): void {
  if (!isRequestSubject(subject)) {
    throw new Error(
      'Value is not a RequestSubject produced by deriveSubject(). Refusing to send: the subject of a ' +
        'rights request must trace back to a provider-verified identity record (CLAUDE.md).',
    );
  }
  if (subject.userId !== userId || subject.identityId !== identityId) {
    throw new Error(
      `Subject/owner mismatch: subject belongs to user ${subject.userId} (identity ${subject.identityId}) ` +
        `but the request is for user ${userId} (identity ${identityId}). Refusing to send.`,
    );
  }
}

/** Project a subject down to only the fields a playbook declared it needs (data minimisation). */
export function projectSubject(
  subject: RequestSubject,
  fields: readonly SubjectField[],
): Record<string, string | Date | PostalAddress | readonly PostalAddress[]> {
  const out: Record<string, string | Date | PostalAddress | readonly PostalAddress[]> = {};
  for (const f of fields) {
    if (f === 'legalName') out.legalName = subject.legalName;
    if (f === 'dateOfBirth') out.dateOfBirth = subject.dateOfBirth;
    if (f === 'addresses') {
      out.primaryAddress = subject.primaryAddress;
      out.additionalAddresses = subject.additionalAddresses;
    }
  }
  return out;
}
