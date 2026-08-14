import type { EnvelopeCrypto } from './envelope.js';

/**
 * Per-user keys, by PURPOSE — the mechanism behind Art. 17 erasure (audit H2/W14).
 *
 * ------------------------------------------------------------------------------------------------
 * WHY CRYPTO-SHRED AT ALL
 * ------------------------------------------------------------------------------------------------
 * `RequestEvent` and `EvidenceRecord` are append-only by database trigger, and deliberately so: an
 * evidence chain that can be edited is not evidence. That makes deletion-based erasure impossible —
 * the cascades declared in the schema could never fire through those triggers. Crypto-shred answers
 * both halves at once: destroy the key and the payload is unreadable, while the ledger survives
 * intact and still proves what we did and when.
 *
 * ------------------------------------------------------------------------------------------------
 * WHY TWO KEYS AND NOT ONE
 * ------------------------------------------------------------------------------------------------
 * A single DEK shredded on erasure would throw away a legal defence we are entitled to keep.
 * Art. 17(3)(e) preserves data needed for the establishment, exercise or defence of legal claims,
 * and this product SENDS LETTERS ON A USER'S BEHALF — if a controller later disputes that a request
 * was ever made, or made lawfully, the artefacts proving it are the only answer we have. Erasing
 * them on request would mean answering that dispute with nothing.
 *
 *   DOSSIER   the data we hold ABOUT the user because they asked us to act: identity fields,
 *             addresses, and (pass 2) credit-file contents. Shredded IMMEDIATELY on Art. 17 erasure.
 *             This is the key whose destruction is the erasure.
 *
 *   EVIDENCE  the data proving WHAT WE DID on their behalf — today the subject snapshot inside the
 *             append-only request ledger. Survives erasure to a limitation window, then a job
 *             shreds it too, so the retention is bounded rather than perpetual.
 *
 * The split is not a hedge. It is the difference between "we no longer hold your data" (true after a
 * DOSSIER shred) and "we destroyed the record of the letters we sent for you" (which would be both
 * unlawful to promise and foolish to do).
 *
 * ------------------------------------------------------------------------------------------------
 * THE THIRD KEY, AND WHY IT IS NOT HERE
 * ------------------------------------------------------------------------------------------------
 * `User.wrappedDek` predates this and seals the TOTP secret. It stays where it is on purpose: a
 * second factor that shared the DOSSIER key would be opened by any DOSSIER compromise, and would be
 * destroyed by a shred that has nothing to do with authentication. Erasure shreds it too — the
 * account is gone — but it is a separate act on a separate key.
 *
 * ------------------------------------------------------------------------------------------------
 * WHAT THIS DOES NOT PROTECT AGAINST — say this exactly, and no more
 * ------------------------------------------------------------------------------------------------
 * The threat this closes is **a stolen database dump or backup**. Both the API and the worker hold
 * the DOSSIER key in memory while they work (the worker derives the request subject at dispatch, so
 * it must), which means **a compromised application process is not covered**. Nor is a compromised
 * KEK. Writing anything stronger than that into a DPIA would be describing a control we do not have.
 */

export const KEY_PURPOSES = ['DOSSIER', 'EVIDENCE'] as const;
export type KeyPurpose = (typeof KEY_PURPOSES)[number];

/**
 * How long the EVIDENCE key outlives an erasure before its own shred.
 *
 * Three years is the regelmäßige Verjährungsfrist of § 195 BGB, running from the end of the year in
 * which the claim arose (§ 199(1)) — so the job that shreds these must compute from year-end, not
 * from the erasure date, or it will destroy the defence a few months early.
 *
 * TODO(counsel): confirm 3 years is the right window for the claims this product could actually
 * face, and whether any of them carry a longer one. The NUMBER is counsel's; the mechanism is not.
 */
export const EVIDENCE_RETENTION_YEARS = 3;

/** When the EVIDENCE key for an erasure at `erasedAt` becomes shreddable (§ 199(1) BGB year-end). */
export function evidenceShredDueAt(erasedAt: Date): Date {
  const endOfYear = Date.UTC(erasedAt.getUTCFullYear() + 1, 0, 1);
  return new Date(Date.UTC(new Date(endOfYear).getUTCFullYear() + EVIDENCE_RETENTION_YEARS, 0, 1));
}

/** Per-user key material for one purpose, as stored. `wrappedDek === null` means SHREDDED. */
export interface PurposeKeyRow {
  readonly wrappedDek: Buffer | null;
  readonly kekRef: string;
  readonly shreddedAt: Date | null;
}

export interface PurposeKeyStore {
  /** Null when no key of that purpose has ever been provisioned for the user. */
  get(userId: string, purpose: KeyPurpose): Promise<PurposeKeyRow | null>;
}

/**
 * The key is gone. Thrown rather than returning null so a caller cannot mistake erased data for
 * absent data — the two mean very different things, and only one of them is a reason to re-collect.
 */
export class KeyShreddedError extends Error {
  constructor(public readonly userId: string, public readonly purpose: KeyPurpose) {
    super(
      `the ${purpose} key for user ${userId} has been shredded — this payload is permanently ` +
        'unreadable, which is what an Art. 17 erasure means. Do not treat it as missing data and do ' +
        'not re-collect it.',
    );
    this.name = 'KeyShreddedError';
  }
}

export class KeyMissingError extends Error {
  constructor(userId: string, purpose: KeyPurpose) {
    super(
      `no ${purpose} key is provisioned for user ${userId}. Keys are minted at registration; a user ` +
        'without one predates the key store and needs the backfill migration, and sealing new data ' +
        'under a key that does not exist must fail rather than silently write plaintext.',
    );
    this.name = 'KeyMissingError';
  }
}

/**
 * Seal and open per-user payloads under a purpose key.
 *
 * Deliberately narrow: `seal`/`open` over strings and Dates, and nothing that takes arbitrary
 * pre-serialised bytes. Every field this protects is a subject identifier, and a generic
 * bytes-in-bytes-out surface is how one of them ends up sealed under the wrong purpose — which, for
 * DOSSIER vs EVIDENCE, is the difference between data that survives an erasure and data that does
 * not.
 */
export class PurposeCipher {
  constructor(
    private readonly crypto: EnvelopeCrypto,
    private readonly keys: PurposeKeyStore,
  ) {}

  async sealText(userId: string, purpose: KeyPurpose, plaintext: string): Promise<Buffer> {
    const key = await this.liveKey(userId, purpose);
    return this.crypto.encrypt(key.wrappedDek!, key.kekRef, Buffer.from(plaintext, 'utf8'));
  }

  async openText(userId: string, purpose: KeyPurpose, ciphertext: Buffer): Promise<string> {
    const key = await this.liveKey(userId, purpose);
    return (await this.crypto.decrypt(key.wrappedDek!, key.kekRef, ciphertext)).toString('utf8');
  }

  /** Dates round-trip as ISO-8601. A Date is a subject identifier here, not a timestamp. */
  async sealDate(userId: string, purpose: KeyPurpose, value: Date): Promise<Buffer> {
    return this.sealText(userId, purpose, value.toISOString());
  }

  async openDate(userId: string, purpose: KeyPurpose, ciphertext: Buffer): Promise<Date> {
    return new Date(await this.openText(userId, purpose, ciphertext));
  }

  /**
   * Read a payload whose key may be gone, for surfaces that must keep rendering after an erasure —
   * an ops queue listing a request whose subject exercised Art. 17 should show the row, not a 500.
   * Returns null ONLY for a shredded key; a missing key or a corrupt payload still throws, because
   * those are faults and a shred is not.
   */
  async openTextOrShredded(userId: string, purpose: KeyPurpose, ciphertext: Buffer): Promise<string | null> {
    try {
      return await this.openText(userId, purpose, ciphertext);
    } catch (e) {
      if (e instanceof KeyShreddedError) return null;
      throw e;
    }
  }

  private async liveKey(userId: string, purpose: KeyPurpose): Promise<PurposeKeyRow> {
    const key = await this.keys.get(userId, purpose);
    if (!key) throw new KeyMissingError(userId, purpose);
    // Both conditions, not either: a row that lost its key material without a shred stamp is a
    // corruption, and treating it as an erasure would quietly write off data nobody asked us to
    // erase. The database CHECK keeps the two in step; this is the code side of the same rule.
    if (key.shreddedAt !== null || key.wrappedDek === null) throw new KeyShreddedError(userId, purpose);
    return key;
  }
}
