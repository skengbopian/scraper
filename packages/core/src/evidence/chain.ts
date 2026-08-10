import { createHash } from 'node:crypto';
import type { QualifiedTimestamp, Timestamper } from '../providers/index.js';

/**
 * Tamper-evident evidence ledger (CLAUDE.md §6).
 *
 * A self-generated hash chain proves INTEGRITY — that record N has not been altered since record N+1
 * was written. It does not prove TIME: we could have written the whole chain this morning. Only a
 * qualified eIDAS timestamp establishes when. Clock-critical records therefore carry both.
 */

export type EvidenceKind = 'OUTBOUND_COPY' | 'SCREENSHOT' | 'POSTAL_PROOF' | 'RESPONSE_COPY';

export interface EvidenceRecord {
  readonly id: string;
  readonly requestId: string;
  readonly kind: EvidenceKind;
  readonly sha256: string;
  readonly prevHash: string | null;
  readonly chainHash: string;
  readonly qualifiedTimestamp: QualifiedTimestamp | null;
  readonly storageRef: string;
  readonly createdAt: Date;
}

export const GENESIS_HASH = null;

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** chainHash = H(prevHash ?? '' | sha256 | kind | requestId) — order fixed, do not reorder. */
export function computeChainHash(args: {
  prevHash: string | null;
  sha256: string;
  kind: EvidenceKind;
  requestId: string;
}): string {
  return sha256Hex(`${args.prevHash ?? ''}|${args.sha256}|${args.kind}|${args.requestId}`);
}

/** Kinds whose TIME is legally load-bearing and therefore must carry a QTSP anchor. */
const CLOCK_CRITICAL: readonly EvidenceKind[] = ['POSTAL_PROOF', 'OUTBOUND_COPY'];

export function isClockCritical(kind: EvidenceKind): boolean {
  return CLOCK_CRITICAL.includes(kind);
}

export interface AppendInput {
  readonly requestId: string;
  readonly kind: EvidenceKind;
  readonly content: string | Uint8Array;
  readonly storageRef: string;
  readonly prevHash: string | null;
  readonly now: Date;
  readonly idFactory: () => string;
}

export async function appendEvidence(
  input: AppendInput,
  timestamper: Timestamper,
): Promise<EvidenceRecord> {
  const sha256 = sha256Hex(input.content);
  const chainHash = computeChainHash({
    prevHash: input.prevHash,
    sha256,
    kind: input.kind,
    requestId: input.requestId,
  });
  // Anchor the CHAIN hash, not the content hash: that pins the whole prefix of the chain to a
  // qualified time, not just this one document.
  const qualifiedTimestamp = isClockCritical(input.kind) ? await timestamper.anchor(chainHash) : null;
  return Object.freeze({
    id: input.idFactory(),
    requestId: input.requestId,
    kind: input.kind,
    sha256,
    prevHash: input.prevHash,
    chainHash,
    qualifiedTimestamp,
    storageRef: input.storageRef,
    createdAt: input.now,
  });
}

export interface ChainVerdict {
  readonly intact: boolean;
  readonly brokenAt: number | null;
  readonly reason: string | null;
}

export function verifyChain(records: readonly EvidenceRecord[]): ChainVerdict {
  let prev: string | null = GENESIS_HASH;
  for (const [i, r] of records.entries()) {
    if (r.prevHash !== prev) {
      return { intact: false, brokenAt: i, reason: `record ${r.id} expected prevHash ${prev}, has ${r.prevHash}` };
    }
    const expected = computeChainHash({ prevHash: r.prevHash, sha256: r.sha256, kind: r.kind, requestId: r.requestId });
    if (expected !== r.chainHash) {
      return { intact: false, brokenAt: i, reason: `record ${r.id} chainHash does not recompute — content or metadata was altered` };
    }
    if (isClockCritical(r.kind) && r.qualifiedTimestamp === null) {
      return { intact: false, brokenAt: i, reason: `record ${r.id} is clock-critical (${r.kind}) but carries no qualified timestamp` };
    }
    prev = r.chainHash;
  }
  return { intact: true, brokenAt: null, reason: null };
}
