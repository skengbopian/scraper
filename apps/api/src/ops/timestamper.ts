import type { TimestampAnchor, Timestamper } from '@scraper/core';

/** DI token: the API's qualified-timestamp client, if one is configured. */
export const TIMESTAMPER = Symbol('TIMESTAMPER');

/**
 * The anchor the API uses when no QTSP client is configured — which is every environment today.
 *
 * It returns a SIMULATED anchor rather than throwing, and that choice is load-bearing. The postal
 * channel already reasons this way (`apps/worker/src/channels/postal.ts`): a carrier's delivery
 * receipt is legally meaningful evidence whether or not we can qualify its time, so losing it would
 * be strictly worse than being unable to use it. So an ops human recording an Auslieferungsbeleg on
 * a machine with no QTSP account still gets the receipt hash-chained into the evidence ledger — the
 * record survives — and `provableSendEvidenceIdOf()` then refuses to mint the id, so the Art. 12(3)
 * clock does NOT start and the request stays in AWAITING_DELIVERY_PROOF. Fail closed, keep the
 * evidence.
 *
 * There is deliberately no dev flag that makes this return `QUALIFIED`. The whole point of the
 * branded `ProvableSendEvidenceId` is that there is exactly one path to a statutory clock and it
 * runs through a real trust service provider (see packages/core/src/evidence/provable-send.ts).
 *
 * TODO(safety): replace with a real eIDAS QTSP client behind an env-selected factory, the same shape
 * as the postal/ident/model providers. Until then the manual delivery-proof route records receipts
 * and reports honestly that it cannot start a clock.
 */
export class UnconfiguredTimestamper implements Timestamper {
  async anchor(sha256Hex: string): Promise<TimestampAnchor> {
    return {
      kind: 'SIMULATED',
      tsaRef: `unconfigured:${sha256Hex.slice(0, 16)}`,
      signedAt: new Date(),
      algorithm: 'sha256',
      reason:
        'no qualified timestamp authority is configured for this process, so the time of this record ' +
        'is asserted by us and by nobody else (docs/05 §6). Evidence is still chained; the Art. 12(3) ' +
        'clock cannot start from it.',
    };
  }
}
