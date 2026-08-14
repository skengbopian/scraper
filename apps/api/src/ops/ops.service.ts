import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
// Value import: DI metadata (see ops-role.guard.ts).
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  apply,
  appendEvidence,
  openVerifiedIdentity,
  provableSendEvidenceIdOf,
  runGuards,
  sha256Hex,
  UnprovableSendError,
  type DeliveryProof,
  type EvidenceRecord,
  type RequestSnapshot,
  type RequestTypeStatutory,
  type Timestamper,
  type TransitionResult,
  type VerifiedIdentity,
  type WorkflowEngine,
} from '@scraper/core';
import { AesGcmEnvelopeCrypto, type PurposeCipher } from '@scraper/core';
import { kekResolver } from '../auth/auth.service.js';
import { createPurposeCipher } from '../identity/user-key.store.js';
import { UnconfiguredTimestamper } from './timestamper.js';

/**
 * The human review surface (port wave 5, ADR-037). Wave 2c deliberately refused to build the /ops
 * SCREEN because these endpoints did not exist and the screen would have been a mock-up of a
 * capability the product did not have. These are the endpoints.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS SURFACE DELIBERATELY DOES NOT SHOW
 * ---------------------------------------------------------------------------------------------
 * The queue exposes request state, controller, timers and the ops reason — and NOT the subject's
 * legal name, date of birth or address. An ops reviewer resolving a ticket does not need to know
 * whose file it is, and a cross-user ledger keyed to real identities is the exact artefact
 * `CLAUDE.md`'s one rule describes: a map of who is exercising rights against whom. The user is
 * identified by their opaque id, which is enough to correlate and not enough to locate anyone.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ONE EDGE INTO ESCALATED
 * ---------------------------------------------------------------------------------------------
 * `sendEscalation` applies `humanSend` with actor `HUMAN_OPS`. That is the ONLY inbound edge to
 * ESCALATED (ADR-008, invariant 3), `tools/spec-audit/statemachine.mjs` asserts by graph analysis
 * that a second one has not appeared, and the state machine rejects the event for any other actor.
 * Nothing in this file, and nothing in the ops UI, may become a second way in — however convenient
 * a "send" button on the user's own screen would look.
 */

export type OpsResolution = 'complied' | 'incomplete' | 'refused' | 'escalate' | 'resend';

const EVENT_BY_RESOLUTION: Readonly<Record<OpsResolution, string>> = Object.freeze({
  complied: 'humanResolve:complied',
  incomplete: 'humanResolve:incomplete',
  refused: 'humanResolve:refused',
  escalate: 'humanResolve:escalate',
  resend: 'humanResolve:resend',
});

export interface OpsQueueItem {
  readonly id: string;
  readonly userId: string;
  readonly controllerSlug: string;
  readonly requestType: string;
  readonly state: string;
  readonly statutoryDeadlineAt: Date | null;
  readonly provisionalDeadlineAt: Date | null;
  readonly clockIsProvable: boolean;
  /** Why a human is looking at this: the last humanQueued / sendPermanentlyFailed / lowConfidence reason. */
  readonly reason: string | null;
  readonly queuedAt: Date;
  /**
   * WHERE an Art. 77 complaint for this case gets filed (decision D4).
   *
   * Until D4 the playbook schema required `seatDpa` on exactly one shape, nothing read it at
   * escalation time, and "the user's own Land DPA" — the correct venue for a US broker with no
   * German establishment — could not be written down at all. So an ops reviewer looking at a drafted
   * complaint had to go and find the venue in a spreadsheet, and a MISSING venue was
   * indistinguishable from a deliberately dynamic one. Now the playbook says which, and this carries
   * the answer to the screen.
   *
   * `kind: 'USER_RESIDENCE'` deliberately arrives with `dpa: null`. Resolving it needs the data
   * subject's Land, and this payload does not carry subject data (see the header) — nor does the
   * postcode → Land → authority map exist yet.
   * TODO(counsel): OQ-20 — that map, and whether one-stop-shop applies to any of these controllers.
   */
  readonly escalationVenue: { readonly kind: 'SEAT'; readonly dpa: string } | { readonly kind: 'USER_RESIDENCE'; readonly dpa: null } | null;
}

@Injectable()
export class OpsService {
  constructor(
    private readonly db: PrismaClient,
    /** The same engine the API schedules deadline timers into; null when no scheduler is configured. */
    private readonly scheduler: WorkflowEngine | null = null,
    /**
     * The qualified-timestamp client. Defaults to the unconfigured one, which anchors honestly as
     * SIMULATED — so a receipt recorded on a machine with no QTSP is still chained, and still
     * cannot start a statutory clock. See ./timestamper.ts.
     */
    private readonly timestamper: Timestamper = new UnconfiguredTimestamper(),
    /**
     * The dossier cipher. Ops NEVER renders subject identifiers (see the header) — this exists for
     * the ONE thing that needs them: `resolve('resend')` re-enters READY, and invariant 1 says every
     * entry to READY re-runs the full guard set, which includes checking that the request's subject
     * still equals the verified identity. The plaintext is used inside `runGuards` and leaves this
     * method in no response.
     */
    private readonly cipher: PurposeCipher = createPurposeCipher(db, new AesGcmEnvelopeCrypto(kekResolver())),
  ) {}

  /**
   * Everything waiting on a person: NEEDS_HUMAN tickets, drafted complaints awaiting a send
   * decision, and READY requests the dispatcher could not send (which have no state of their own —
   * see the human-queue note in the worker).
   */
  async queue(): Promise<readonly OpsQueueItem[]> {
    const rows = await this.db.rightsRequest.findMany({
      where: { OR: [{ state: 'NEEDS_HUMAN' }, { state: 'ESCALATION_DRAFTED' }, { state: 'READY', events: { some: { type: 'humanQueued' } } }] },
      orderBy: { createdAt: 'asc' },
      include: {
        controller: { select: { slug: true } },
        playbook: { select: { document: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 5, select: { type: true, payload: true, createdAt: true } },
      },
    });
    return rows.map((r) => {
      const explaining = r.events.find((e) => ['humanQueued', 'sendPermanentlyFailed', 'lowConfidence|ambiguous'].includes(e.type));
      const payload = explaining?.payload as { reason?: string; note?: string } | null;
      return {
        id: r.id,
        // The opaque id, never the subject's identifiers. See the header.
        userId: r.userId,
        controllerSlug: r.controller.slug,
        requestType: String(r.requestType),
        state: r.state,
        statutoryDeadlineAt: r.deadlineAt,
        provisionalDeadlineAt: r.provisionalDeadlineAt,
        clockIsProvable: r.provableSendConfirmedAt !== null,
        reason: payload?.reason ?? payload?.note ?? null,
        queuedAt: explaining?.createdAt ?? r.createdAt,
        escalationVenue: venueOf(r.playbook.document),
      };
    });
  }

  /**
   * Resolve a NEEDS_HUMAN ticket.
   *
   * Two guards are NOT re-implemented here, and that is deliberate — they live in `apply()`, where
   * every caller meets them:
   *   - invariant 5: a human resolution is what lets an outcome stand without the deterministic
   *     parser agreeing. The actor requirement (HUMAN_OPS) is the whole mechanism.
   *   - invariant 3b: `humanResolve:escalate` needs `provableSendConfirmedAt` OR a controller
   *     response. A NEEDS_HUMAN reached via `sendPermanentlyFailed` has neither, and drafting an
   *     Art. 77 complaint there would assert receipt that nothing establishes.
   *
   * `resend` is the exception that DOES need work here: it re-enters READY, and invariant 1 says
   * every entry to READY re-runs the full guard set.
   */
  async resolve(requestId: string, resolution: OpsResolution): Promise<{ state: string; outcome: string | null }> {
    const event = EVENT_BY_RESOLUTION[resolution];
    if (!event) {
      throw new BadRequestException({
        error: 'INVALID_RESOLUTION',
        message: `resolution must be one of ${Object.keys(EVENT_BY_RESOLUTION).join(', ')}`,
      });
    }
    const snapshot = await this.mustLoad(requestId);
    if (resolution === 'resend') await this.assertMayReEnterReady(snapshot);

    // reviewedByHuman is TRUE here and nowhere else in this codebase: the worker never sets it
    // (ingest.ts), and it is what lets a low-confidence parse reach a decided outcome at all.
    const result = this.transition({ ...snapshot, reviewedByHuman: true }, event, 'HUMAN_OPS');
    await this.persist(requestId, result);
    return { state: result.to, outcome: result.patch.outcome ?? null };
  }

  /**
   * Send the drafted Art. 77 complaint. THE only edge into ESCALATED (ADR-008).
   *
   * The complaint copy itself is a counsel-owned artefact and is not generated here; what this does
   * is record the send as hash-chained evidence and move the state. Evidence is written BEFORE the
   * transition, the same ordering the outbound gateway uses, so an ESCALATED row can never exist
   * without the record of what was sent.
   */
  async sendEscalation(requestId: string, opsUserId: string): Promise<{ state: string }> {
    const snapshot = await this.mustLoad(requestId);
    if (snapshot.state !== 'ESCALATION_DRAFTED') {
      throw new ConflictException({
        error: 'NO_DRAFT_TO_SEND',
        message: `request is in ${snapshot.state}; only a drafted complaint can be sent`,
      });
    }
    const draft = await this.db.evidenceRecord.findFirst({
      where: { requestId, kind: 'SCREENSHOT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    // TODO(counsel): the complaint document itself is not rendered by this product yet — the
    // drafted state records that one is DUE, and ops attaches the letter it filed. What is chained
    // here is the fact and the actor, which is what invariant 7 requires of a legally-meaningful
    // action. Rendering the Art. 77 text is a counsel-owned template, not code.
    const content = `ART77_SENT requestId=${requestId} by=${opsUserId} draftEvidence=${draft?.id ?? 'none'}`;
    const sha256 = sha256Hex(content);
    const result = this.transition(snapshot, 'humanSend', 'HUMAN_OPS');
    // Evidence and transition commit ATOMICALLY. The chain is append-only: a record asserting
    // ART77_SENT for a send whose transition then failed could never be removed, only contradicted.
    // The chain-head read also lives inside the transaction so a losing concurrent writer cannot
    // fork the chain.
    await this.persist(requestId, result, { opsUserId }, async (tx) => {
      const last = await tx.evidenceRecord.findFirst({ where: { requestId }, orderBy: { createdAt: 'desc' }, select: { chainHash: true } });
      await tx.evidenceRecord.create({
        data: {
          requestId,
          kind: 'SCREENSHOT',
          sha256,
          prevHash: last?.chainHash ?? null,
          chainHash: sha256Hex(`${last?.chainHash ?? ''}|${sha256}|SCREENSHOT|${requestId}`),
          storageRef: `ops://escalation/${requestId}/sent.txt`,
        },
      });
    });
    return { state: result.to };
  }

  /**
   * Record a carrier's delivery receipt (Auslieferungsbeleg) by hand, and — if it qualifies — start
   * the Art. 12(3) clock from it. This is the MANUAL half of audit F3a, and today it is the only
   * half that exists.
   *
   * Why a manual route at all. Automated receipt retrieval is blocked on the postal vendor (OQ-11),
   * but the receipt itself is a piece of paper that arrives in an office. Making the statutory clock
   * wait for a vendor integration would mean the product's central legal mechanism stays unreachable
   * for a reason that has nothing to do with the law. So an ops human types in what the receipt says,
   * and the retrieval job — when it exists — will apply exactly the same transition with exactly the
   * same evidence. Automation replaces the ACTOR here, not the rule.
   *
   * The ordering is deliberate and copied from the postal channel:
   *
   *   1. anchor and persist the POSTAL_PROOF evidence UNCONDITIONALLY. A carrier receipt is
   *      meaningful evidence whether or not our anchor turns out to be qualified; losing it would be
   *      worse than being unable to use it.
   *   2. THEN try to mint the branded `ProvableSendEvidenceId` from the persisted record. There is
   *      no other constructor, and it refuses a simulated anchor, a non-carrier origin, or a record
   *      that does not reference this receipt.
   *   3. Only a successful mint reaches `apply()`. A refusal returns 409 with the machine-readable
   *      reason, the receipt already stored, and the request still in AWAITING_DELIVERY_PROOF.
   *
   * TODO(safety): `origin: 'CARRIER'` is asserted by the ops human, who is looking at the carrier's
   * paper receipt. That is an attestation, not a machine fact — which is why the route is behind the
   * ops role, why the attesting user id goes into the RequestEvent payload, and why the retrieval
   * job (which gets `origin` from the carrier's own API) is the better long-term source.
   * TODO(counsel): whether a scanned Auslieferungsbeleg re-keyed by an operator, anchored at a QTSP
   * at re-keying time, is sufficient evidence of the delivery DATE before a DPA — or whether the
   * carrier's own electronic record must be fetched — is a legal question, not an engineering one.
   */
  async recordDeliveryProof(
    requestId: string,
    input: { readonly trackingRef: string; readonly deliveredAt: Date; readonly storageRef: string },
    opsUserId: string,
  ): Promise<{ state: string; deadlineAt: Date | null; evidenceId: string; clockStarted: boolean }> {
    const snapshot = await this.mustLoad(requestId);
    if (snapshot.state !== 'AWAITING_DELIVERY_PROOF' && snapshot.state !== 'SENT') {
      throw new ConflictException({
        error: 'NO_LODGEMENT_AWAITING_PROOF',
        message:
          `request is in ${snapshot.state}; a delivery receipt can only be recorded against a ` +
          'registered send that is lodged (AWAITING_DELIVERY_PROOF) or still acknowledging (SENT)',
        nextAction: 'VIEW_REQUEST',
      });
    }
    const now = new Date();
    if (input.deliveredAt.getTime() > now.getTime()) {
      throw new BadRequestException({
        error: 'DELIVERY_IN_FUTURE',
        message: 'a delivery receipt cannot evidence a delivery that has not happened yet',
      });
    }

    const proof: DeliveryProof = {
      kind: 'EINWURF_EINSCHREIBEN',
      trackingRef: input.trackingRef,
      deliveredAt: input.deliveredAt,
      // Attested by the ops human from the carrier's paper receipt — see the TODO(safety) above.
      origin: 'CARRIER',
    };
    // The chained content names the receipt, the delivery time and who attested it, so the ledger
    // records not just THAT a proof exists but which one and on whose word.
    const content = `POSTAL_PROOF requestId=${requestId} tracking=${proof.trackingRef} delivered=${proof.deliveredAt.toISOString()} attestedBy=${opsUserId}`;
    const record = await this.appendPostalProof(requestId, content, input.storageRef, proof, now);

    let evidenceId;
    try {
      evidenceId = provableSendEvidenceIdOf(record, proof);
    } catch (e) {
      if (!(e instanceof UnprovableSendError)) throw e;
      // Fail CLOSED, and say exactly why. The receipt is stored (step 1 above); what is missing is
      // the qualified time, and no amount of ops privilege can supply it.
      throw new ConflictException({
        error: `UNPROVABLE_${e.reason}`,
        message:
          `the receipt was recorded as evidence ${record.id}, but it cannot start the Art. 12(3) ` +
          `clock: ${e.message}`,
        nextAction: 'VIEW_REQUEST',
      });
    }

    const result = apply(snapshot, 'provableSendConfirmed', {
      actor: 'HUMAN_OPS',
      now,
      // THE point of the whole async path: the month runs from when the carrier says it was
      // delivered, not from when a person got round to typing it in.
      deliveredAt: input.deliveredAt,
      provableSendEvidenceId: evidenceId,
      reason: `delivery receipt ${proof.trackingRef} recorded by ops`,
    });
    await this.persist(requestId, result, { opsUserId, evidenceId: record.id, trackingRef: proof.trackingRef });
    if (result.patch.deadlineAt) await this.armDeadline(requestId, 'statutory', result.patch.deadlineAt);
    return { state: result.to, deadlineAt: result.patch.deadlineAt ?? null, evidenceId: record.id, clockStarted: true };
  }

  /**
   * Append the POSTAL_PROOF record, or return the existing one for the same receipt.
   *
   * Idempotent on the content hash because a re-submitted receipt is the SAME fact, and an
   * append-only ledger cannot be tidied up afterwards: a double-click that chained the same
   * Auslieferungsbeleg twice would leave two immortal records of one delivery.
   */
  private async appendPostalProof(
    requestId: string,
    content: string,
    storageRef: string,
    proof: DeliveryProof,
    now: Date,
  ): Promise<EvidenceRecord> {
    const sha256 = sha256Hex(content);
    const existing = await this.db.evidenceRecord.findFirst({ where: { requestId, kind: 'POSTAL_PROOF', sha256 } });
    if (existing) {
      return {
        id: existing.id,
        requestId,
        kind: 'POSTAL_PROOF',
        sha256: existing.sha256,
        prevHash: existing.prevHash,
        chainHash: existing.chainHash,
        qualifiedTimestamp:
          existing.qualifiedTimestampRef === null || existing.anchorKind === null
            ? null
            : existing.anchorKind === 'QUALIFIED'
              ? { kind: 'QUALIFIED', tsaRef: existing.qualifiedTimestampRef, signedAt: existing.createdAt, algorithm: 'sha256' }
              : {
                  kind: 'SIMULATED',
                  tsaRef: existing.qualifiedTimestampRef,
                  signedAt: existing.createdAt,
                  algorithm: 'sha256',
                  reason: 'anchor recorded as SIMULATED when this record was written',
                },
        storageRef: existing.storageRef,
        createdAt: existing.createdAt,
      };
    }

    const last = await this.db.evidenceRecord.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
      select: { chainHash: true },
    });
    // `appendEvidence` is what anchors: POSTAL_PROOF is clock-critical, so it calls the timestamper
    // itself and records whatever kind of anchor it got — honestly, including SIMULATED.
    const built = await appendEvidence(
      {
        requestId,
        kind: 'POSTAL_PROOF',
        content,
        // The storageRef must name the receipt: `provableSendEvidenceIdOf` refuses a record whose
        // storageRef does not reference the trackingRef it claims to anchor (PROOF_MISMATCH), which
        // is what stops the outbound letter's own evidence being passed off as a delivery proof.
        storageRef: storageRef.includes(proof.trackingRef) ? storageRef : `${storageRef}#${proof.trackingRef}`,
        prevHash: last?.chainHash ?? null,
        now,
        idFactory: () => 'pending',
      },
      this.timestamper,
    );
    const created = await this.db.evidenceRecord.create({
      data: {
        requestId,
        kind: 'POSTAL_PROOF',
        sha256: built.sha256,
        prevHash: built.prevHash,
        chainHash: built.chainHash,
        qualifiedTimestampRef: built.qualifiedTimestamp?.tsaRef ?? null,
        anchorKind: built.qualifiedTimestamp?.kind ?? null,
        storageRef: built.storageRef,
      },
      select: { id: true },
    });
    // The DB-assigned id is what gets branded, so the id authorising the clock is the id of a row
    // that actually exists (the worker's adapter does the same).
    return { ...built, id: created.id };
  }

  async discardEscalation(requestId: string, opsUserId: string): Promise<{ state: string; outcome: string | null }> {
    const snapshot = await this.mustLoad(requestId);
    const result = this.transition(snapshot, 'humanDiscard', 'HUMAN_OPS');
    await this.persist(requestId, result, { opsUserId });
    return { state: result.to, outcome: result.patch.outcome ?? null };
  }

  /**
   * The anomaly review list (CLAUDE.md C1; audit M3). Rows carry opaque ids and a bounded detail
   * string — the same no-subject-data discipline as the queue above.
   */
  async anomalies(): Promise<
    readonly { id: string; userId: string | null; kind: string; detail: string; createdAt: Date; reviewedAt: Date | null }[]
  > {
    return this.db.anomalyEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, userId: true, kind: true, detail: true, createdAt: true, reviewedAt: true },
    });
  }

  // --- inbound documents ------------------------------------------------------------------------

  async submitInboundDocument(input: {
    readonly channel: 'email' | 'postal' | 'web_form';
    readonly senderRef: string;
    readonly subjectLine?: string;
    readonly storageRef: string;
    readonly sha256: string;
    readonly retentionDays: number;
  }): Promise<{ id: string }> {
    const receivedAt = new Date();
    return this.db.inboundDocument.create({
      data: {
        receivedAt,
        channel: input.channel,
        senderRef: input.senderRef.slice(0, 500),
        subjectLine: input.subjectLine?.slice(0, 500) ?? null,
        storageRef: input.storageRef,
        sha256: input.sha256,
        // CLAUDE.md §4: never store a raw reference without the date it stops being stored.
        purgeRawAt: new Date(receivedAt.getTime() + input.retentionDays * 86_400_000),
      },
      select: { id: true },
    });
  }

  async listInbound(): Promise<readonly {
    id: string; receivedAt: Date; channel: string; senderRef: string; subjectLine: string | null;
    assignedRequestId: string | null;
  }[]> {
    return this.db.inboundDocument.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 200,
      select: { id: true, receivedAt: true, channel: true, senderRef: true, subjectLine: true, assignedRequestId: true },
    });
  }

  /**
   * Correlate a document to a request. A HUMAN decision, recorded as one.
   *
   * The request id comes from the ops caller, never from the document — a reply that quotes a
   * reference is a hint for the person reading it, not an instruction to the system. `senderRef` and
   * `subjectLine` are stored untrusted and rendered as-is for exactly that reason.
   */
  async assignInboundDocument(documentId: string, requestId: string, opsUserId: string): Promise<{ assigned: true; ingestQueued: boolean }> {
    const doc = await this.db.inboundDocument.findUnique({
      where: { id: documentId },
      select: { assignedRequestId: true, channel: true, receivedAt: true, storageRef: true },
    });
    if (!doc) throw new NotFoundException('inbound document not found');
    if (doc.assignedRequestId) {
      throw new ConflictException({
        error: 'ALREADY_ASSIGNED',
        message: `already correlated to ${doc.assignedRequestId}; a correction is a new document, not a re-point`,
      });
    }
    await this.mustLoad(requestId);
    try {
      await this.db.inboundDocument.update({
        where: { id: documentId },
        // All three move together — 0011's inbound_assignment_is_attributed refuses anything else.
        data: { assignedRequestId: requestId, assignedAt: new Date(), assignedByUserId: opsUserId },
      });
    } catch (e) {
      // Two reviewers racing on one document: the 0011 freeze trigger stops the second write. Map
      // it to the same conflict the sequential path answers, not a raw 500 (audit W12).
      const now = await this.db.inboundDocument.findUnique({ where: { id: documentId }, select: { assignedRequestId: true } });
      if (now?.assignedRequestId) {
        throw new ConflictException({
          error: 'ALREADY_ASSIGNED',
          message: `already correlated to ${now.assignedRequestId}; a correction is a new document, not a re-point`,
        });
      }
      throw e;
    }

    // Correlation without ingestion is bookkeeping only: the request would stay in
    // AWAITING_RESPONSE(_PROVISIONAL) with a reply on file, and the statutory timer would later
    // draft an Art. 77 complaint alleging SILENCE — a false assertion. Hand the document to the
    // worker's ingest pipeline: the job carries the storage reference (never bytes through the
    // queue); a document the sandbox cannot read fails closed to NEEDS_HUMAN with the
    // ControllerResponse row — and therefore proven receipt — recorded either way.
    let ingestQueued = false;
    if (this.scheduler) {
      await this.scheduler.schedule(`ingest:${documentId}`, new Date(), {
        name: 'ingest-response',
        payload: {
          requestId,
          channel: doc.channel,
          document: {
            id: doc.storageRef,
            mimeType: 'application/octet-stream',
            bytes: [],
            receivedAt: doc.receivedAt.toISOString(),
          },
        },
      });
      ingestQueued = true;
    }
    return { assigned: true, ingestQueued };
  }

  // --- internals --------------------------------------------------------------------------------

  private transition(snapshot: RequestSnapshot, event: string, actor: 'HUMAN_OPS'): TransitionResult {
    try {
      return apply(snapshot, event, { actor, now: new Date() });
    } catch (e) {
      throw new ConflictException({ error: 'ILLEGAL_TRANSITION', message: (e as Error).message });
    }
  }

  /** Invariant 1: every entry to READY re-runs the full guard set, including this one. */
  private async assertMayReEnterReady(snapshot: RequestSnapshot): Promise<void> {
    const identity = await this.db.identity.findUnique({ where: { userId: snapshot.userId }, include: { addresses: true } });
    if (!identity) {
      throw new ConflictException({ error: 'GUARD_IDENTITY', message: 'the requesting user has no identity record' });
    }
    const [mandates, siblings] = await Promise.all([
      this.db.mandate.findMany({ where: { userId: snapshot.userId, revokedAt: null } }),
      this.db.rightsRequest.findMany({
        where: {
          userId: snapshot.userId, controllerId: snapshot.controllerId, requestType: snapshot.requestType as never,
          state: { notIn: ['COMPLIED', 'CLOSED_FAILED', 'WITHDRAWN'] },
        },
        select: { id: true, userId: true, controllerId: true, requestType: true },
      }),
    ]);
    const guards = runGuards({
      requestId: snapshot.id,
      userId: snapshot.userId,
      controllerId: snapshot.controllerId,
      requestType: snapshot.requestType as RequestTypeStatutory,
      identity: await openVerifiedIdentity(this.cipher, identity),
      mandates: mandates.map((m) => ({
        id: m.id, userId: m.userId, scope: m.scope as unknown as RequestTypeStatutory[],
        signedAt: m.signedAt, revokedAt: m.revokedAt,
      })),
      nonTerminalSiblings: siblings.map((s) => ({ ...s, requestType: String(s.requestType) })),
      now: new Date(),
    });
    if (!guards.ok) {
      // A mandate revoked mid-flight, or a duplicate opened meanwhile, must block an ops re-send
      // exactly as it blocks a user's. Ops is a privileged actor, not an exempt one.
      throw new ConflictException({
        error: `GUARD_${guards.failed.toUpperCase()}`,
        message: guards.reason,
        nextAction: 'VIEW_REQUEST',
      });
    }
  }

  /**
   * Arm a durable timer for a clock this surface just started.
   *
   * The timestamp is part of the key (the worker's convention, audit F7): pg-boss dedupes on the
   * singleton key, so re-arming the same kind for the same request would otherwise be swallowed
   * while the spent key still exists.
   */
  private async armDeadline(requestId: string, kind: 'statutory' | 'provisional' | 'proof', at: Date): Promise<void> {
    if (!this.scheduler) return;
    await this.scheduler.schedule(`deadline:${requestId}:${kind}:${at.getTime()}`, at, {
      name: 'deadline-expiry',
      payload: { requestId, kind },
    });
  }

  private async persist(
    id: string,
    t: TransitionResult,
    extra?: Record<string, unknown>,
    alsoInTransaction?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    const data: Record<string, unknown> = { state: t.to };
    if (t.patch.outcome !== undefined) data.outcome = t.patch.outcome;
    if (t.patch.closedAt !== undefined) data.closedAt = t.patch.closedAt;
    // The clock columns are written here too, for the same reason the requests repository writes
    // them: `apply()` is the only thing that may compute them, so whatever it put in the patch must
    // reach the row atomically with the state change. Before the manual delivery-proof route no ops
    // transition touched a clock, so this block did not exist — and adding the route without it
    // would have moved the request into AWAITING_RESPONSE with `deadlineAt` still null, i.e. into
    // the one state whose entire meaning is that a deadline is running.
    if (t.patch.deadlineAt !== undefined) data.deadlineAt = t.patch.deadlineAt;
    if (t.patch.provisionalDeadlineAt !== undefined) data.provisionalDeadlineAt = t.patch.provisionalDeadlineAt;
    if (t.patch.proofDueAt !== undefined) data.proofDueAt = t.patch.proofDueAt;
    if (t.patch.provableSendConfirmedAt !== undefined) data.provableSendConfirmedAt = t.patch.provableSendConfirmedAt;
    await this.db.$transaction(async (tx) => {
      // Compare-and-swap on the from-state: two reviewers acting on one ticket must yield ONE
      // transition and ONE event in the append-only log — the loser sees a conflict and re-loads,
      // it never writes a duplicate humanSend/humanResolve.
      const updated = await tx.rightsRequest.updateMany({ where: { id, state: t.from as never }, data: data as never });
      if (updated.count === 0) {
        throw new ConflictException({
          error: 'STALE_STATE',
          message: `request ${id} is no longer in ${t.from} — another actor moved it first`,
          nextAction: 'VIEW_REQUEST',
        });
      }
      await tx.requestEvent.create({
        data: {
          requestId: id, type: t.event, fromState: t.from, toState: t.to, actor: t.actor,
          payload: { note: t.note ?? null, ...(t.reason ? { reason: t.reason } : {}), ...(extra ?? {}) },
        },
      });
      if (alsoInTransaction) await alsoInTransaction(tx);
    });
  }

  private async mustLoad(id: string): Promise<RequestSnapshot> {
    const r = await this.db.rightsRequest.findUnique({
      where: { id },
      include: {
        playbook: { select: { document: true } },
        responses: { select: { id: true }, take: 1 },
      },
    });
    if (!r) throw new NotFoundException('request not found');
    const doc = r.playbook.document as { validation?: { humanReviewIfConfidenceBelow?: number } } | null;
    return {
      id: r.id, state: r.state as RequestSnapshot['state'], userId: r.userId, controllerId: r.controllerId,
      requestType: String(r.requestType),
      provableSendConfirmedAt: r.provableSendConfirmedAt, deadlineAt: r.deadlineAt,
      provisionalDeadlineAt: r.provisionalDeadlineAt, proofDueAt: r.proofDueAt,
      // Invariant 3b reads this: a controller's own reply proves receipt where no provable send does.
      hasControllerResponse: r.responses.length > 0,
      reviewedByHuman: false, parseConfidence: null,
      humanReviewIfConfidenceBelow: doc?.validation?.humanReviewIfConfidenceBelow ?? 1,
      outcome: (r.outcome ?? null) as RequestSnapshot['outcome'],
    };
  }
}

/**
 * Read the venue off the playbook document. Two fields, one answer, and never both.
 *
 * The schema's C2 conditional (D4) insists that any playbook which can reach ESCALATION_DRAFTED
 * declares `seatDpa` OR `venue`, so `null` here means the playbook predates that rule or is not an
 * escalating one — it is never a silent default to some fallback authority. Guessing a venue would
 * be worse than showing none: a complaint filed at the wrong authority is not a small mistake.
 */
function venueOf(document: unknown): OpsQueueItem['escalationVenue'] {
  const doc = document as { seatDpa?: unknown; venue?: unknown } | null;
  if (typeof doc?.seatDpa === 'string' && doc.seatDpa.length > 0) return { kind: 'SEAT', dpa: doc.seatDpa };
  if (doc?.venue === 'USER_RESIDENCE') return { kind: 'USER_RESIDENCE', dpa: null };
  return null;
}

