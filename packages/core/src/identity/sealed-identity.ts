import type { KeyPurpose, PurposeCipher } from '../crypto/user-keys.js';
import type { VerifiedIdentity } from './subject.js';

/**
 * The one place a sealed Identity row becomes a `VerifiedIdentity`.
 *
 * It lives in core rather than in the API or the worker because BOTH need it and the two must not
 * drift: the API builds the identity for the guards, the worker builds it again at dispatch to
 * derive the letter's subject (ADR-009 — the subject is derived at send time, from the Identity row,
 * never threaded through a queue). Two implementations of "decrypt the dossier" would be two places
 * for one of them to fall back to an empty string, and an empty string in this shape becomes an
 * empty Anschrift line in a legal letter.
 *
 * `deriveSubject()` is still the only constructor of a `RequestSubject` and still throws unless the
 * identity is VERIFIED. This function does not weaken that; it only supplies the plaintext.
 */

const DOSSIER: KeyPurpose = 'DOSSIER';

export interface SealedIdentityRow {
  readonly id: string;
  readonly userId: string;
  readonly status: string;
  readonly method: string | null;
  readonly legalNameEnc: Buffer | null;
  readonly dateOfBirthEnc: Buffer | null;
  readonly verifiedAt: Date | null;
  readonly providerRef: string | null;
  readonly addresses: readonly {
    readonly streetEnc: Buffer;
    readonly postalCodeEnc: Buffer;
    readonly cityEnc: Buffer;
    readonly country: string;
    readonly current: boolean;
    readonly verifiedAt: Date;
  }[];
}

export async function openVerifiedIdentity(
  cipher: PurposeCipher,
  row: SealedIdentityRow,
): Promise<VerifiedIdentity> {
  const open = (buf: Buffer | null) => (buf === null ? null : cipher.openText(row.userId, DOSSIER, buf));
  const [legalName, dateOfBirthIso] = await Promise.all([open(row.legalNameEnc), open(row.dateOfBirthEnc)]);
  const addresses = await Promise.all(
    row.addresses.map(async (a) => ({
      street: await cipher.openText(row.userId, DOSSIER, a.streetEnc),
      postalCode: await cipher.openText(row.userId, DOSSIER, a.postalCodeEnc),
      city: await cipher.openText(row.userId, DOSSIER, a.cityEnc),
      country: a.country,
      current: a.current,
      verifiedAt: a.verifiedAt,
    })),
  );
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as VerifiedIdentity['status'],
    method: (row.method ?? 'EID') as VerifiedIdentity['method'],
    // The empty defaults are unchanged from the plaintext era and mean the same thing:
    // `deriveSubject()` throws on an unverified identity before these are read, so a partially
    // filled row fails THERE, with the identity error, rather than producing a nameless letter here.
    legalName: legalName ?? '',
    dateOfBirth: dateOfBirthIso === null ? new Date(0) : new Date(dateOfBirthIso),
    addresses,
    verifiedAt: row.verifiedAt,
    providerRef: row.providerRef,
  };
}

/** What a writer must produce to persist an identity. Kept beside the reader so they cannot drift. */
export async function sealIdentityFields(
  cipher: PurposeCipher,
  userId: string,
  fields: { readonly legalName: string; readonly dateOfBirth: Date },
): Promise<{ legalNameEnc: Buffer; dateOfBirthEnc: Buffer }> {
  const [legalNameEnc, dateOfBirthEnc] = await Promise.all([
    cipher.sealText(userId, DOSSIER, fields.legalName),
    cipher.sealDate(userId, DOSSIER, fields.dateOfBirth),
  ]);
  return { legalNameEnc, dateOfBirthEnc };
}

export async function sealAddressLines(
  cipher: PurposeCipher,
  userId: string,
  lines: { readonly street: string; readonly postalCode: string; readonly city: string },
): Promise<{ streetEnc: Buffer; postalCodeEnc: Buffer; cityEnc: Buffer }> {
  const [streetEnc, postalCodeEnc, cityEnc] = await Promise.all([
    cipher.sealText(userId, DOSSIER, lines.street),
    cipher.sealText(userId, DOSSIER, lines.postalCode),
    cipher.sealText(userId, DOSSIER, lines.city),
  ]);
  return { streetEnc, postalCodeEnc, cityEnc };
}
