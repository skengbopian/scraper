// Value import: DI metadata (see ops-role.guard.ts — this repo has been bitten twice).
import { PrismaClient } from '@prisma/client';
import {
  AesGcmEnvelopeCrypto,
  KEY_PURPOSES,
  PurposeCipher,
  type EnvelopeCrypto,
  type KeyPurpose,
  type PurposeKeyRow,
  type PurposeKeyStore,
} from '@scraper/core';

/**
 * The Postgres-backed purpose key store, plus the two operations that change a key's LIFE:
 * provisioning at registration, and shredding at erasure.
 *
 * Everything here is deliberately small and boring. The interesting decisions — why two keys, what
 * each protects, what the threat model actually is — live in `packages/core/src/crypto/user-keys.ts`
 * next to the cipher that enforces them.
 */
export class PrismaUserKeyStore implements PurposeKeyStore {
  constructor(private readonly db: PrismaClient) {}

  async get(userId: string, purpose: KeyPurpose): Promise<PurposeKeyRow | null> {
    const row = await this.db.userKey.findUnique({
      where: { userId_purpose: { userId, purpose } },
      select: { wrappedDek: true, kekRef: true, shreddedAt: true },
    });
    if (!row) return null;
    return {
      wrappedDek: row.wrappedDek === null ? null : Buffer.from(row.wrappedDek),
      kekRef: row.kekRef,
      shreddedAt: row.shreddedAt,
    };
  }
}

/**
 * Mint every purpose key a user needs, if they do not already have them.
 *
 * Idempotent by the (userId, purpose) unique index rather than by a read-then-write: two concurrent
 * registrations of the same account — which the decoy-registration path (audit M5) makes a real
 * shape rather than a theoretical one — must not produce two DOSSIER keys, because the second would
 * silently orphan everything sealed under the first.
 *
 * Called at registration and by the backfill. NOT called lazily on first use: a key minted on demand
 * would mean a read path could create key material, and "why does this user have a dossier key" would
 * stop having a single answer.
 */
export async function provisionUserKeys(
  db: PrismaClient,
  crypto: EnvelopeCrypto,
  userId: string,
  kekRef: string,
): Promise<void> {
  for (const purpose of KEY_PURPOSES) {
    const { wrappedDek } = await crypto.generateWrappedDek(kekRef);
    await db.userKey.upsert({
      where: { userId_purpose: { userId, purpose } },
      create: { userId, purpose, wrappedDek, kekRef },
      // A key that exists is never replaced — rotation is a separate, deliberate operation that has
      // to re-seal every payload, and doing it accidentally here would make the old data unreadable.
      // A SHREDDED key is likewise never re-minted: re-provisioning after an Art. 17 erasure would
      // hand the user a working dossier key for data they asked us to destroy.
      update: {},
    });
  }
}

/**
 * Destroy a purpose key. THIS IS THE ERASURE — everything sealed under it becomes permanently
 * unreadable at the moment this commits.
 *
 * The row survives its own key material on purpose: `shreddedAt` is the evidence that the erasure
 * happened and when, which is exactly what a supervisory authority would ask for. A deleted row
 * proves nothing, and the append-only ledgers hanging off this user could not be deleted anyway.
 *
 * Returns false when there was no key to shred, so a caller can tell "erased" from "nothing to
 * erase" without inferring it from an absence.
 */
export async function shredUserKey(db: PrismaClient, userId: string, purpose: KeyPurpose, at: Date): Promise<boolean> {
  const { count } = await db.userKey.updateMany({
    // `shreddedAt: null` makes this idempotent AND preserves the original stamp: a second erasure
    // request must not rewrite the date of the first, which is the date that would be produced as
    // evidence.
    where: { userId, purpose, shreddedAt: null },
    data: { wrappedDek: null, shreddedAt: at },
  });
  return count > 0;
}

/** The cipher, wired to Postgres. One per process; it holds no state beyond its two collaborators. */
export function createPurposeCipher(db: PrismaClient, crypto: EnvelopeCrypto): PurposeCipher {
  return new PurposeCipher(crypto, new PrismaUserKeyStore(db));
}

export { AesGcmEnvelopeCrypto };
