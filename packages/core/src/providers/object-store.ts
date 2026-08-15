import { sha256Hex } from '../evidence/chain.js';

/**
 * The evidence object store — the seam between "we hashed this" and "we still have it".
 *
 * ---------------------------------------------------------------------------------------------
 * WHY A HASH IS NOT ENOUGH
 * ---------------------------------------------------------------------------------------------
 * `EvidenceRecord` carries `sha256` and `storageRef`. The hash proves the artefact has not been
 * altered; the ref is supposed to say where the artefact IS. Until now the worker wrote
 * `unconfigured://evidence/<id>/<file>` into that field — a well-formed reference to nothing. The
 * chain verified, the seal was green, and the letter we would have to produce at a DPA existed
 * nowhere. A hash of a document nobody has is not evidence; it is a claim about a document nobody
 * has.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS MODULE IS AND IS NOT
 * ---------------------------------------------------------------------------------------------
 * Interface and pure reference logic only. `@scraper/core` does no I/O (see its package
 * description), so the adapters — filesystem for posture A, S3-compatible EU for B/C — live in
 * `apps/worker/src/providers/object-store/`. What lives here is everything that must be answered
 * the SAME way by every adapter and by every caller: what a key may contain, what a reference
 * means, and what a deleter must do with a reference it does not recognise.
 */

/** The reference schemes that deliberately name NO stored blob. Each is a fact, not a placeholder. */
export const MARKER_REF_SCHEMES: readonly string[] = [
  // The worker before an object store existed. Kept in the list because rows written under it are
  // still in the database on any node that ran the alpha.
  'unconfigured',
  // The API's simulate surface (`apps/api/src/requests/requests.service.ts`) — a dev transition that
  // never produced a document.
  'sim',
  // An ops action whose content is the evidence record itself (`ops://escalation/...`).
  'ops',
  // The in-memory repository and the test doubles.
  'mem',
  // The tombstone the purge sweep writes over a ref once the blob is gone (migration 0005 +
  // `PrismaWorkerRepository.tombstoneInboundDocumentRaw`). Purging a tombstone again is a no-op.
  'purged',
];

export interface ObjectRef {
  readonly scheme: string;
  /** Everything after `://`. For `fs` that is the key; for `s3` it is `<bucket>/<key>`. */
  readonly rest: string;
}

export function parseObjectRef(ref: string): ObjectRef | null {
  const i = ref.indexOf('://');
  if (i <= 0) return null;
  const scheme = ref.slice(0, i);
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return null;
  return { scheme, rest: ref.slice(i + 3) };
}

/** True when the reference is a marker: there has never been a blob, so there is nothing to delete. */
export function isMarkerRef(ref: string): boolean {
  const parsed = parseObjectRef(ref);
  return parsed !== null && MARKER_REF_SCHEMES.includes(parsed.scheme);
}

export class UnsafeObjectKeyError extends Error {
  constructor(key: string, why: string) {
    super(`unsafe object key ${JSON.stringify(key)}: ${why}`);
    this.name = 'UnsafeObjectKeyError';
  }
}

/** Keys are paths on somebody's disk. 512 is far above any key this product constructs. */
const KEY_MAX_LENGTH = 512;

/**
 * Reject a key that could escape its store, or that would make the reference ambiguous.
 *
 * THIS IS A BOUNDARY CHECK, not tidiness. One component of a real evidence key comes from outside:
 * `postal-proof-${proof.trackingRef}.txt`, where `trackingRef` is whatever the carrier's API
 * returned (`ControllerGateway.send`). A tracking reference of `../../../../etc/cron.d/x` would,
 * on a filesystem store, write the rendered receipt outside the evidence root. The user's global
 * rule and CLAUDE.md agree here: never trust an external API's response shape.
 *
 * It REJECTS rather than sanitises, and that is deliberate. `provableSendEvidenceIdOf()` refuses a
 * postal proof whose `storageRef` does not literally contain the `trackingRef` it claims to anchor
 * (PROOF_MISMATCH, evidence/provable-send.ts). A sanitiser that rewrote the key would therefore
 * turn an unusual carrier reference into an unprovable send *silently*, which is the failure mode
 * this whole line exists to remove. Rejecting is loud: dispatch fails, a human looks at it.
 *
 * The permitted set is otherwise wide — real carrier references contain dots, dashes and
 * occasionally spaces, and none of those can escape anything.
 */
export function assertSafeObjectKey(key: string): void {
  if (key.length === 0) throw new UnsafeObjectKeyError(key, 'empty');
  if (key.length > KEY_MAX_LENGTH) throw new UnsafeObjectKeyError(key, `longer than ${KEY_MAX_LENGTH} characters`);
  if (key.includes('://')) throw new UnsafeObjectKeyError(key, 'contains "://", which would make the reference ambiguous');
  if (key.includes('\\')) throw new UnsafeObjectKeyError(key, 'contains a backslash');
  for (const ch of key) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) throw new UnsafeObjectKeyError(key, `contains the control character U+${code.toString(16).padStart(4, '0')}`);
  }
  const segments = key.split('/');
  for (const segment of segments) {
    if (segment === '') throw new UnsafeObjectKeyError(key, 'has an empty path segment (leading, trailing or doubled "/")');
    if (segment === '.' || segment === '..') throw new UnsafeObjectKeyError(key, `has a "${segment}" segment — path traversal`);
    if (segment.startsWith('.')) throw new UnsafeObjectKeyError(key, `has a segment starting with "." (${segment})`);
    if (segment.endsWith('.') || segment.endsWith(' ')) throw new UnsafeObjectKeyError(key, `has a segment ending in "." or a space (${segment})`);
  }
}

/**
 * Where evidence artefacts and raw controller documents are stored.
 *
 * Deliberately three methods and no more. Listing, copying and lifecycle rules are things a store
 * could offer and this product must not want: the only questions it asks are "keep this", "give it
 * back", and "it is past its retention window, destroy it" (CLAUDE.md §4).
 */
export interface ObjectStore {
  /** For the boot log and for readiness — the operator must be able to see which store resolved. */
  readonly name: string;

  /**
   * Store bytes under `key`, returning the reference to record in evidence.
   *
   * IDEMPOTENT, AND ONLY IDEMPOTENT. Re-putting identical bytes under the same key succeeds (the
   * dispatch path can crash between the put and the evidence row and retry). Putting DIFFERENT
   * bytes under a key that already exists MUST throw: the evidence chain hashes what was sent, and
   * a store that let a later write replace an anchored artefact would leave the chain verifying
   * against a document that is no longer there.
   */
  put(key: string, bytes: Uint8Array | string): Promise<string>;

  /** The stored bytes, or `null` when the object is absent — already purged, or never written. */
  get(ref: string): Promise<Uint8Array | null>;

  /** Idempotent: deleting an absent object succeeds. Throws if this store does not own `ref`. */
  delete(ref: string): Promise<void>;

  /** Whether `ref` names an object THIS store could resolve. Bucket-specific for S3, scheme-only for fs. */
  owns(ref: string): boolean;
}

/**
 * What a deleter must do with a reference.
 *
 * The purge sweep is the caller that matters (`apps/worker/src/workflows/purge.ts`): it deletes the
 * blob and then tombstones the row. The dangerous case is the one in the middle — a reference this
 * store does not own. Treating that as "nothing to delete" would tombstone the row while the raw
 * document, which is hostile input we promised to destroy, stays on whichever store actually holds
 * it. So an unrecognised reference is REFUSE, and the sweep raises rather than lying.
 *
 * That does mean switching a node from `fs` to `s3` without migrating the blobs stops the purge
 * sweep. It should: the blobs are still there and the retention window has still expired.
 */
export type ObjectRefRouting =
  | { readonly action: 'DELETE' }
  | { readonly action: 'SKIP'; readonly reason: string }
  | { readonly action: 'REFUSE'; readonly reason: string };

export function routeObjectRef(ref: string, store: ObjectStore | null): ObjectRefRouting {
  if (isMarkerRef(ref)) return { action: 'SKIP', reason: 'marker reference — no blob was ever stored under it' };
  if (store === null) {
    return {
      action: 'REFUSE',
      reason: `no object store is configured, so the blob behind ${ref} cannot be deleted — tombstoning the row would record a purge that did not happen`,
    };
  }
  if (!store.owns(ref)) {
    return {
      action: 'REFUSE',
      reason: `${ref} was written by a different store than the configured one (${store.name}) — its blob is still wherever it was put`,
    };
  }
  return { action: 'DELETE' };
}

export interface StoredObjectVerdict {
  readonly present: boolean;
  /** The hash of what is actually in the store, or `null` when nothing is there. */
  readonly sha256: string | null;
  /** Present AND byte-identical to what the evidence record claims. */
  readonly matches: boolean;
  readonly reason: string | null;
}

/**
 * Does the store still hold exactly the bytes an evidence record hashed?
 *
 * This is the question the whole module exists to make answerable — and the one a DPA or a court
 * would ask. It is a function rather than a method so it works against any adapter and so the
 * answer is computed from the bytes, never from anything the store reports about itself.
 */
export async function verifyStoredObject(
  store: ObjectStore,
  ref: string,
  expectedSha256: string,
): Promise<StoredObjectVerdict> {
  const bytes = await store.get(ref);
  if (bytes === null) {
    return { present: false, sha256: null, matches: false, reason: `nothing is stored at ${ref}` };
  }
  const actual = sha256Hex(bytes);
  if (actual !== expectedSha256) {
    return {
      present: true,
      sha256: actual,
      matches: false,
      reason: `the stored bytes hash to ${actual}, but the evidence record claims ${expectedSha256}`,
    };
  }
  return { present: true, sha256: actual, matches: true, reason: null };
}
