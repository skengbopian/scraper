import type { Mailer, MailerResult, PostalProvider, PostalSendResult, TimestampAnchor, Timestamper } from '@scraper/core';

/**
 * Dev stubs. Nothing here touches a network, and — the part that matters — nothing here can start a
 * statutory clock.
 *
 * ---------------------------------------------------------------------------------------------
 * THE STUB-PROOF HAZARD, and how these differ from A's
 * ---------------------------------------------------------------------------------------------
 * The pre-audit line's `StubPostalProvider` returned `proofRef: 'stub:einwurf-proof-N'` for any
 * `registered: true` call. Inert there. Here, a delivery proof is one of the two facts that
 * authorise `provableSendConfirmed`, so a receipt-shaped stub would start a real Art. 12(3)
 * deadline against a real controller — a deadline we could never evidence at a DPA.
 *
 * Two independent markers close it, and they live on two different providers so that no single
 * misconfigured seam is enough:
 *
 *   `StubPostalProvider` → `proof.origin: 'SIMULATED'`   (no carrier issued this)
 *   `SimulatedTimestamper` → `anchor.kind: 'SIMULATED'`  (no QTSP signed this)
 *
 * `provableSendEvidenceIdOf()` refuses either. The consequence is deliberate and should not be
 * "fixed": **a process with no QTSP account and no hybrid-mail account cannot start a statutory
 * clock at all.** A registered send degrades to a provisional clock and says so. That is the honest
 * behaviour — a deadline we cannot prove is a deadline we may not assert (CLAUDE.md §6).
 *
 * The stubs still SEND (into the void) and still return provider references, because the rest of the
 * pipeline — evidence capture, idempotency, the event log — is real and worth exercising.
 */

let seq = 0;

export class StubMailer implements Mailer {
  async send(msg: { to: string; subject: string; text: string }): Promise<MailerResult> {
    seq += 1;
    // accepted + dkimAligned are TRUE here, and that is safe by construction: the email adapter's
    // return type has no provable variant, so the best possible email result is still a provisional
    // clock. In the pre-audit line these same two defaults mapped onto the provable edge.
    return { messageId: `stub-mail-${seq}@scraper.invalid`, accepted: true, dkimAligned: true };
  }
}

export class StubPostalProvider implements PostalProvider {
  async send(_letter: { text: string; recipient: string }, opts: { registered: boolean }): Promise<PostalSendResult> {
    seq += 1;
    return {
      providerId: `stub-postal-${seq}`,
      proof: opts.registered
        ? {
            kind: 'EINWURF_EINSCHREIBEN',
            trackingRef: `stub-einwurf-${seq}`,
            deliveredAt: new Date(),
            // THE marker. A stub may not claim a carrier issued its receipt.
            origin: 'SIMULATED',
          }
        : null,
    };
  }
}

export class SimulatedTimestamper implements Timestamper {
  async anchor(sha256Hex: string): Promise<TimestampAnchor> {
    return {
      kind: 'SIMULATED',
      tsaRef: `sim:${sha256Hex.slice(0, 16)}`,
      signedAt: new Date(),
      algorithm: 'SHA-256',
      reason: 'no QTSP account is configured (SCRAPER_TIMESTAMPER=simulated) — this establishes integrity, not legal time',
    };
  }
}
