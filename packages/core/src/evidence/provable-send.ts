import { isQualifiedAnchor, type DeliveryProof } from '../providers/index.js';
import type { EvidenceRecord } from './chain.js';

/**
 * The constructor for the one value that can start the Art. 12(3) clock.
 *
 * WHY THIS FILE EXISTS. `apply(..., 'provableSendConfirmed', ...)` is the single edge that may set
 * `deadlineAt` (invariant 2), and it demanded a `provableSendEvidenceId: string`. Any string
 * satisfied it. That was survivable while nothing but the dev simulate surface produced one; it
 * stops being survivable the moment a worker dispatches for real, because the obvious dev wiring —
 * a stub postal provider that returns a receipt-shaped object for every registered send, and a
 * timestamper pointed at a vendor sandbox — produces exactly the shape the guard was looking for.
 * The pre-audit line shipped that stub (`proofRef: 'stub:einwurf-proof-N'`); it was inert there
 * only because that line started the clock off email anyway.
 *
 * So the id is BRANDED and this is its only constructor. Two independent facts must both hold, and
 * they come from two different providers, so no single misconfigured vendor can produce one alone:
 *
 *   1. the carrier actually issued a receipt   — `DeliveryProof.origin === 'CARRIER'`
 *   2. that receipt is anchored at a real QTSP — `EvidenceRecord.qualifiedTimestamp.kind === 'QUALIFIED'`
 *
 * There is deliberately **no** simulated constructor, not even a dev-gated one. A second minter is a
 * second way in, and the whole reason this line exists is that the pre-audit line had one. A process
 * with no QTSP account therefore cannot start a statutory clock at all — it fails closed to the
 * human queue. That is the correct answer, not a limitation to work around: a deadline we cannot
 * evidence is a deadline we may not assert (CLAUDE.md §6, ADR-012).
 */

declare const PROVABLE_SEND_BRAND: unique symbol;

/**
 * An `EvidenceRecord.id` that has been checked to prove delivery. Unforgeable by construction: the
 * brand is a `unique symbol` no other module can name, so `apply()`'s parameter cannot be satisfied
 * by a string literal, a request id, or a provider reference.
 */
export type ProvableSendEvidenceId = string & { readonly [PROVABLE_SEND_BRAND]: 'ProvableSendEvidenceId' };

export class UnprovableSendError extends Error {
  constructor(
    /** Machine-readable so callers can route (human queue) without string-matching the message. */
    public readonly reason:
      | 'WRONG_EVIDENCE_KIND'
      | 'NO_ANCHOR'
      | 'SIMULATED_ANCHOR'
      | 'SIMULATED_PROOF'
      | 'PROOF_MISMATCH',
    message: string,
  ) {
    super(
      `${message} — this send cannot start the Art. 12(3) clock. Route it to the human queue or ` +
        `send on a non-provable channel (sendAccepted:nonProvable), which sets a provisional ` +
        `deadline only (CLAUDE.md §6).`,
    );
    this.name = 'UnprovableSendError';
  }
}

/**
 * Mint the evidence id for a provable send, or throw.
 *
 * `proof` and `record` are BOTH required because they answer different questions and are produced by
 * different vendors: the postal provider says a carrier delivered, the timestamper says when that
 * fact was fixed. Accepting one without the other is how a sandbox becomes a legal deadline.
 */
export function provableSendEvidenceIdOf(
  record: EvidenceRecord,
  proof: DeliveryProof,
): ProvableSendEvidenceId {
  if (record.kind !== 'POSTAL_PROOF') {
    throw new UnprovableSendError(
      'WRONG_EVIDENCE_KIND',
      `evidence record ${record.id} is a ${record.kind}, not a POSTAL_PROOF. An OUTBOUND_COPY is ` +
        `anchored too (it is clock-critical for OUR send time), but it evidences that we sent — not ` +
        `that they received, which is the whole distinction ADR-012 turns on`,
    );
  }
  if (record.qualifiedTimestamp === null) {
    throw new UnprovableSendError('NO_ANCHOR', `postal proof ${record.id} carries no timestamp anchor`);
  }
  if (!isQualifiedAnchor(record.qualifiedTimestamp)) {
    throw new UnprovableSendError(
      'SIMULATED_ANCHOR',
      `postal proof ${record.id} is anchored by a SIMULATED timestamper ` +
        `(${record.qualifiedTimestamp.reason})`,
    );
  }
  if (proof.origin !== 'CARRIER') {
    throw new UnprovableSendError(
      'SIMULATED_PROOF',
      `the delivery receipt for ${record.id} was produced by a simulated postal provider ` +
        `(origin=${proof.origin}, trackingRef=${proof.trackingRef}), not by a carrier`,
    );
  }
  // The anchored bytes must be the receipt itself. Without this an implementation could anchor the
  // outbound letter and pass the proof object beside it, and every check above would still pass.
  if (!record.storageRef.includes(proof.trackingRef)) {
    throw new UnprovableSendError(
      'PROOF_MISMATCH',
      `postal proof ${record.id} (storageRef ${record.storageRef}) does not reference the delivery ` +
        `receipt ${proof.trackingRef} it is supposed to anchor`,
    );
  }
  return record.id as ProvableSendEvidenceId;
}

/**
 * Would this evidence record + receipt pair authorise the statutory clock? Non-throwing form, for
 * callers deciding a route rather than performing a transition.
 */
export function isProvableSend(record: EvidenceRecord, proof: DeliveryProof | null): boolean {
  if (proof === null) return false;
  try {
    provableSendEvidenceIdOf(record, proof);
    return true;
  } catch {
    return false;
  }
}
