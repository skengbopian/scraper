import {
  appendEvidence,
  sha256Hex,
  type DeliveryProof,
  type EvidenceRecord,
  type Mailer,
  type PostalProvider,
  type Timestamper,
} from '@scraper/core';
import { sendLegalRequestEmail } from '../channels/email.js';
import { sendPostalLetter } from '../channels/postal.js';
import type { SendOutcome } from '../channels/types.js';

/**
 * The Controller Gateway (docs/02): the single chokepoint every outbound request passes through.
 * Send-level idempotency (state machine §5b), evidence capture, then the channel adapter.
 *
 * ---------------------------------------------------------------------------------------------
 * THE SUBTLE RE-ENTRY THIS FILE EXISTS TO CLOSE
 * ---------------------------------------------------------------------------------------------
 * The pre-audit line's gateway (`gateway/controller-gateway.ts:114-137`) anchored the OUTBOUND_COPY
 * with `timestamper.anchor()` for BOTH channels alike, and it was right to. `isClockCritical()` says
 * OUTBOUND_COPY is clock-critical, because when WE sent is a fact we may one day have to prove.
 *
 * The danger is what that anchor then LOOKS like. A qualified eIDAS timestamp sitting on an email
 * send reads, to any later reader, like the proof that authorises a deadline — and in that line it
 * effectively was, because `provable` was a boolean the email adapter set to true.
 *
 * Here the anchor is still taken on both channels, and it still cannot authorise anything, because
 * `provableSendEvidenceIdOf()` requires `kind === 'POSTAL_PROOF'`. An OUTBOUND_COPY anchor is
 * structurally the wrong shape to start the clock, no matter how qualified it is. The two facts stay
 * separate: OUTBOUND_COPY = we sent this text, at this time. POSTAL_PROOF = they received it.
 */

export interface GatewaySendRequest {
  readonly requestId: string;
  readonly userId: string;
  readonly controllerId: string;
  readonly requestType: string;
  readonly channel: 'email' | 'postal';
  readonly registered: boolean;
  readonly recipient: string;
  readonly subject: string;
  /** The rendered, counsel-approved letter. The gateway never composes text. */
  readonly body: string;
}

export interface ControllerGatewayDeps {
  readonly mailer: Mailer;
  readonly postal: PostalProvider;
  readonly timestamper: Timestamper;
  /** Persist an evidence record and return it. Also the source of `prevHash`. */
  readonly appendEvidenceRecord: (record: EvidenceRecord) => Promise<EvidenceRecord>;
  readonly latestChainHash: (requestId: string) => Promise<string | null>;
  /**
   * True when an OUTBOUND_COPY already exists for this request's CURRENT DISPATCH ATTEMPT — the
   * at-most-once wire guard. This is send-level idempotency (state machine §5b) and is emphatically
   * NOT the request-level guard: it asks "did THIS attempt already reach the wire", never "has this
   * triple ever been used" (which would break the lawful second cycle — ADR-013) and never "has this
   * request ever been sent" (which would block the registered re-send — the chase path re-dispatches
   * the same row, so an attempt is scoped by the most recent entry into READY).
   */
  readonly hasOutboundEvidence: (requestId: string) => Promise<boolean>;
  /** OUTBOUND_COPY count against one controller since `since` — feeds the per-controller flood brake. */
  readonly countOutboundForControllerSince: (controllerId: string, since: Date) => Promise<number>;
  /** CLAUDE.md C1: sends per controller per hour beyond this are an anomaly signal, not throughput. */
  readonly maxSendsPerControllerPerHour: number;
  readonly objectStorePut: (key: string, bytes: string) => Promise<string>;
  readonly idFactory: () => string;
  readonly now: () => Date;
}

export interface OutboundGateway {
  send(req: GatewaySendRequest): Promise<SendOutcome>;
}

export class ControllerGateway implements OutboundGateway {
  constructor(private readonly deps: ControllerGatewayDeps) {}

  async send(req: GatewaySendRequest): Promise<SendOutcome> {
    // (a) At-most-once wire guard. Evidence is captured BEFORE the channel call, so if a record
    // already exists an earlier attempt may have reached the wire (crash, stalled job, redelivery).
    // Never send again — a duplicate legal request risks being deemed excessive under Art. 12(5),
    // and unlike a lost job it cannot be undone. A human reconciles.
    if (await this.deps.hasOutboundEvidence(req.requestId)) {
      return {
        kind: 'FAILED',
        reason:
          'an OUTBOUND_COPY already exists for this request — an earlier attempt may have reached ' +
          'the wire. Refusing to send again (Art. 12(5) duplicate risk); human review required.',
      };
    }

    // (a2) Per-controller flood brake (CLAUDE.md C1: "rate-limit and log all lookups"). Config
    // validated this cap since wave 5 while nothing consumed it (audit W11). A runaway provenance
    // chain or a dispatch bug shows up HERE as volume; refusing into the human queue is the correct
    // failure, because an automatic retry of a flood is the flood.
    const cap = this.deps.maxSendsPerControllerPerHour;
    const hourAgo = new Date(this.deps.now().getTime() - 3_600_000);
    if ((await this.deps.countOutboundForControllerSince(req.controllerId, hourAgo)) >= cap) {
      return {
        kind: 'FAILED',
        reason:
          `per-controller send cap reached (${cap}/hour for controller ${req.controllerId}) — ` +
          'this volume is an anomaly signal, not throughput. Human review required (CLAUDE.md C1).',
      };
    }

    const sentAt = this.deps.now();

    // (b) Capture the rendered copy, anchored. See the header: this anchor evidences OUR send time
    // and can never authorise a deadline.
    try {
      await this.appendAnchored(req.requestId, 'OUTBOUND_COPY', req.body, `outbound-copy-${sentAt.getTime()}.md`);
    } catch (e) {
      // Nothing has touched the wire yet, so this is safe to fail without human review.
      return { kind: 'FAILED', reason: `evidence capture failed before send: ${e instanceof Error ? e.message : String(e)}` };
    }

    // (c) The channel. Each adapter's return type is narrowed to what it can honestly claim.
    if (req.channel === 'email') {
      return sendLegalRequestEmail(this.deps.mailer, { to: req.recipient, subject: req.subject, text: req.body }, sentAt);
    }

    return sendPostalLetter(
      this.deps.postal,
      { text: req.body, recipient: req.recipient },
      { registered: req.registered },
      // The receipt's own storageRef names the tracking ref, which is what
      // provableSendEvidenceIdOf()'s PROOF_MISMATCH check binds: an implementation cannot anchor the
      // letter and pass the receipt beside it.
      (proof: DeliveryProof) =>
        this.appendAnchored(
          req.requestId,
          'POSTAL_PROOF',
          `${proof.kind} ${proof.trackingRef} delivered ${proof.deliveredAt.toISOString()}`,
          `postal-proof-${proof.trackingRef}.txt`,
        ),
      sentAt,
    );
  }

  private async appendAnchored(
    requestId: string,
    kind: 'OUTBOUND_COPY' | 'POSTAL_PROOF',
    content: string,
    filename: string,
  ): Promise<EvidenceRecord> {
    const storageRef = await this.deps.objectStorePut(`evidence/${requestId}/${filename}`, content);
    const record = await appendEvidence(
      {
        requestId,
        kind,
        content,
        storageRef,
        prevHash: await this.deps.latestChainHash(requestId),
        now: this.deps.now(),
        idFactory: this.deps.idFactory,
      },
      this.deps.timestamper,
    );
    return this.deps.appendEvidenceRecord(record);
  }
}

/** Re-exported so callers hashing a body for a log line use the same function the chain does. */
export { sha256Hex };
