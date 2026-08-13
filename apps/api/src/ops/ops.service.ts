import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
// Value import: DI metadata (see ops-role.guard.ts).
import { PrismaClient } from '@prisma/client';
import {
  apply,
  runGuards,
  sha256Hex,
  type RequestSnapshot,
  type RequestTypeStatutory,
  type TransitionResult,
  type VerifiedIdentity,
} from '@scraper/core';

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
}

@Injectable()
export class OpsService {
  constructor(private readonly db: PrismaClient) {}

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
    const last = await this.db.evidenceRecord.findFirst({ where: { requestId }, orderBy: { createdAt: 'desc' }, select: { chainHash: true } });

    // TODO(counsel): the complaint document itself is not rendered by this product yet — the
    // drafted state records that one is DUE, and ops attaches the letter it filed. What is chained
    // here is the fact and the actor, which is what invariant 7 requires of a legally-meaningful
    // action. Rendering the Art. 77 text is a counsel-owned template, not code.
    const content = `ART77_SENT requestId=${requestId} by=${opsUserId} draftEvidence=${draft?.id ?? 'none'}`;
    const sha256 = sha256Hex(content);
    await this.db.evidenceRecord.create({
      data: {
        requestId,
        kind: 'SCREENSHOT',
        sha256,
        prevHash: last?.chainHash ?? null,
        chainHash: sha256Hex(`${last?.chainHash ?? ''}|${sha256}|SCREENSHOT|${requestId}`),
        storageRef: `ops://escalation/${requestId}/sent.txt`,
      },
    });

    const result = this.transition(snapshot, 'humanSend', 'HUMAN_OPS');
    await this.persist(requestId, result, { opsUserId });
    return { state: result.to };
  }

  async discardEscalation(requestId: string, opsUserId: string): Promise<{ state: string; outcome: string | null }> {
    const snapshot = await this.mustLoad(requestId);
    const result = this.transition(snapshot, 'humanDiscard', 'HUMAN_OPS');
    await this.persist(requestId, result, { opsUserId });
    return { state: result.to, outcome: result.patch.outcome ?? null };
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
  async assignInboundDocument(documentId: string, requestId: string, opsUserId: string): Promise<{ assigned: true }> {
    const doc = await this.db.inboundDocument.findUnique({ where: { id: documentId }, select: { assignedRequestId: true } });
    if (!doc) throw new NotFoundException('inbound document not found');
    if (doc.assignedRequestId) {
      throw new ConflictException({
        error: 'ALREADY_ASSIGNED',
        message: `already correlated to ${doc.assignedRequestId}; a correction is a new document, not a re-point`,
      });
    }
    await this.mustLoad(requestId);
    await this.db.inboundDocument.update({
      where: { id: documentId },
      // All three move together — 0011's inbound_assignment_is_attributed refuses anything else.
      data: { assignedRequestId: requestId, assignedAt: new Date(), assignedByUserId: opsUserId },
    });
    return { assigned: true };
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
      identity: toVerifiedIdentity(identity),
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

  private async persist(id: string, t: TransitionResult, extra?: Record<string, unknown>): Promise<void> {
    const data: Record<string, unknown> = { state: t.to };
    if (t.patch.outcome !== undefined) data.outcome = t.patch.outcome;
    if (t.patch.closedAt !== undefined) data.closedAt = t.patch.closedAt;
    await this.db.$transaction([
      this.db.rightsRequest.update({ where: { id }, data: data as never }),
      this.db.requestEvent.create({
        data: {
          requestId: id, type: t.event, fromState: t.from, toState: t.to, actor: t.actor,
          payload: { note: t.note ?? null, ...(t.reason ? { reason: t.reason } : {}), ...(extra ?? {}) },
        },
      }),
    ]);
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
      provisionalDeadlineAt: r.provisionalDeadlineAt,
      // Invariant 3b reads this: a controller's own reply proves receipt where no provable send does.
      hasControllerResponse: r.responses.length > 0,
      reviewedByHuman: false, parseConfidence: null,
      humanReviewIfConfidenceBelow: doc?.validation?.humanReviewIfConfidenceBelow ?? 1,
      outcome: (r.outcome ?? null) as RequestSnapshot['outcome'],
    };
  }
}

function toVerifiedIdentity(row: {
  id: string; userId: string; status: string; method: string | null; legalName: string | null;
  dateOfBirth: Date | null; verifiedAt: Date | null; providerRef: string | null;
  addresses: { street: string; postalCode: string; city: string; country: string; current: boolean; verifiedAt: Date }[];
}): VerifiedIdentity {
  return {
    id: row.id, userId: row.userId, status: row.status as VerifiedIdentity['status'],
    method: (row.method ?? 'EID') as VerifiedIdentity['method'],
    legalName: row.legalName ?? '', dateOfBirth: row.dateOfBirth ?? new Date(0),
    addresses: row.addresses.map((a) => ({
      street: a.street, postalCode: a.postalCode, city: a.city, country: a.country,
      current: a.current, verifiedAt: a.verifiedAt,
    })),
    verifiedAt: row.verifiedAt, providerRef: row.providerRef,
  };
}
