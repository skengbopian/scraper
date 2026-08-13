import {
  provableSendEvidenceIdOf,
  UnprovableSendError,
  type DeliveryProof,
  type EvidenceRecord,
  type PostalProvider,
} from '@scraper/core';
import type { PostalSendOutcome } from './types.js';

/**
 * Captures the carrier's receipt as a QTSP-anchored POSTAL_PROOF evidence record. Supplied by the
 * Controller Gateway, which owns evidence and the timestamper.
 *
 * It is a parameter rather than an import so this module cannot be tested — or run — without one:
 * an implementation that "forgot" to anchor is not a variant this signature admits.
 */
export type AnchorPostalProof = (proof: DeliveryProof) => Promise<EvidenceRecord>;

/**
 * The postal channel. Only the Controller Gateway may call it.
 *
 * This is the ONE adapter that can return `DELIVERY_PROVEN`, and it earns that outcome rather than
 * asserting it. Three things must line up, and `provableSendEvidenceIdOf()` (not this file) is the
 * judge of all three:
 *
 *   1. the send was registered (Einwurf-Einschreiben),
 *   2. the provider returned a receipt whose `origin` is `CARRIER` — a stub must say `SIMULATED`,
 *   3. that receipt is anchored at a real QTSP, not a sandbox or a dev double.
 *
 * The pre-audit line's equivalent computed `provable: opts.registered && result.proofRef !== null`,
 * which its own stub satisfied for every registered call. Here a stub still returns a proof object —
 * that is fine and even useful, because the send did happen — it just cannot mint the evidence id,
 * so the outcome degrades to ACCEPTED_NON_PROVABLE and the request gets a provisional clock. Nothing
 * is lost and nothing is invented.
 */
export async function sendPostalLetter(
  postal: PostalProvider,
  letter: { text: string; recipient: string },
  opts: { registered: boolean },
  anchorProof: AnchorPostalProof,
  now: Date,
): Promise<PostalSendOutcome> {
  let result: Awaited<ReturnType<PostalProvider['send']>>;
  try {
    result = await postal.send(letter, { registered: opts.registered });
  } catch (e) {
    return { kind: 'FAILED', reason: `postal provider threw: ${e instanceof Error ? e.message : String(e)}` };
  }

  const nonProvable = (note: string): PostalSendOutcome => ({
    kind: 'ACCEPTED_NON_PROVABLE',
    channel: 'postal',
    providerRef: result.providerId,
    sentAt: now,
    note,
  });

  if (!opts.registered) {
    return nonProvable('unregistered post: no receipt is produced, so no statutory clock (CLAUDE.md §6)');
  }
  if (result.proof === null) {
    // Einlieferung ≠ Zustellung: the letter is lodged but the Auslieferungsbeleg has not come back
    // yet (docs/10 §2.4(1), OQ-11). A provisional clock now; the proof-retrieval job may upgrade it.
    return nonProvable('registered send lodged, but no delivery receipt has come back yet');
  }

  // Anchoring happens BEFORE minting and unconditionally, because the receipt is legally meaningful
  // evidence whether or not it turns out to be qualified — losing it would be worse than not being
  // able to use it.
  let record: EvidenceRecord;
  try {
    record = await anchorProof(result.proof);
  } catch (e) {
    return { kind: 'FAILED', reason: `sent, but the delivery proof could not be evidenced: ${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    return {
      kind: 'DELIVERY_PROVEN',
      channel: 'postal',
      providerRef: result.providerId,
      sentAt: now,
      evidenceId: provableSendEvidenceIdOf(record, result.proof),
    };
  } catch (e) {
    if (!(e instanceof UnprovableSendError)) throw e;
    // THE STUB-PROOF HAZARD, closed. A simulated receipt or a simulated anchor lands here and the
    // request takes the provisional clock — the same clock an email would have got, which is the
    // honest description of what just happened.
    return nonProvable(`registered send is NOT provable (${e.reason}): ${e.message}`);
  }
}
