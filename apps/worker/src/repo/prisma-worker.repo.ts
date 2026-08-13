import { PrismaClient } from '@prisma/client';
import {
  deriveSubject,
  type EvidenceRecord,
  type Playbook,
  type RequestSnapshot,
  type TimestampAnchor,
  type VerifiedIdentity,
} from '@scraper/core';
import type { DispatchableRequest } from '../workflows/dispatch.js';
import type { ControllerResponseRow, IngestibleRequest } from '../workflows/ingest.js';

/**
 * The worker's Postgres adapter.
 *
 * `PrismaClient` is imported as a VALUE, not `import type`. That is not stylistic: a type-only import
 * is erased, and Nest's DI metadata — and any decorator emit downstream — then has nothing to resolve.
 * The same trap is documented in the API's modules; it is repeated here because the fix is invisible
 * once applied.
 *
 * What this adapter is careful about:
 *
 *  - **The subject is derived at send time, from the Identity row.** Not from a snapshot threaded
 *    through a queue, not from the request. `deriveSubject()` is the only constructor for a
 *    `RequestSubject` and it throws unless the identity is VERIFIED — so a request whose owner's
 *    identity lapsed between creation and dispatch cannot be rendered (CLAUDE.md, ADR-009/019).
 *  - **`forceRegistered` is DERIVED from the event log**, never passed in. It is true exactly when
 *    the most recent entry to READY came from `userConfirmsResend:guardsPass`. A caller-supplied
 *    flag would be a way to force a paid registered send on someone else's request.
 *  - **Evidence carries its anchor's qualification** (0010). A `SIMULATED` anchor is stored as such
 *    rather than as an unlabelled ref that reads like a QTSP one later.
 */
export class PrismaWorkerRepository {
  constructor(private readonly db: PrismaClient) {}

  // --- dispatch -------------------------------------------------------------------------------

  async loadDispatchable(requestId: string): Promise<DispatchableRequest | null> {
    const r = await this.db.rightsRequest.findUnique({
      where: { id: requestId },
      include: {
        playbook: { select: { document: true } },
        user: { include: { identity: { include: { addresses: true } } } },
        events: { orderBy: { createdAt: 'desc' }, select: { type: true, toState: true } },
      },
    });
    if (!r) return null;

    const identity = r.user.identity;
    if (!identity) return null;
    const subject = deriveSubject(toVerifiedIdentity(identity));

    // The most recent transition INTO READY decides whether this dispatch must be registered.
    const lastIntoReady = r.events.find((e) => e.toState === 'READY');
    const forceRegistered = lastIntoReady?.type === 'userConfirmsResend:guardsPass';

    const packet = await this.db.identityPacket.findUnique({
      where: { identityId: identity.id },
      select: { id: true, kind: true, lastAttachedAt: true },
    });

    return {
      snapshot: this.toSnapshot(r),
      playbook: r.playbook.document as unknown as Playbook,
      subject,
      // audit C6: only a packet that was genuinely ATTACHED to this dispatch counts. A packet that
      // merely exists must not make the letter claim an enclosure it does not carry.
      attachedIdentityPacketId: packet && packet.kind !== 'NONE' && packet.lastAttachedAt !== null ? packet.id : null,
      forceRegistered,
    };
  }

  // --- ingest ---------------------------------------------------------------------------------

  async loadIngestible(requestId: string): Promise<IngestibleRequest | null> {
    const r = await this.db.rightsRequest.findUnique({
      where: { id: requestId },
      include: {
        playbook: { select: { document: true } },
        controller: { select: { slug: true } },
        events: { where: { type: 'responseIngested' }, select: { id: true }, take: 1 },
      },
    });
    if (!r) return null;
    return {
      snapshot: this.toSnapshot(r),
      playbook: r.playbook.document as unknown as Playbook,
      controllerSlug: r.controller.slug,
    };
  }

  async createControllerResponse(row: ControllerResponseRow): Promise<{ id: string }> {
    const created = await this.db.controllerResponse.create({
      data: {
        requestId: row.requestId,
        receivedAt: row.receivedAt,
        channel: row.channel === 'web_form' ? 'web_form' : (row.channel as 'email' | 'postal'),
        rawDocumentRef: row.rawDocumentRef,
        purgeRawAt: row.purgeRawAt,
        structured: row.structured as never,
        parseConfidence: row.parseConfidence,
        // The worker is never a human reviewer (invariant 5). Only the ops surface may set this.
        reviewedByHuman: false,
      },
      select: { id: true },
    });
    return created;
  }

  // --- evidence -------------------------------------------------------------------------------

  async latestChainHash(requestId: string): Promise<string | null> {
    const last = await this.db.evidenceRecord.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
      select: { chainHash: true },
    });
    return last?.chainHash ?? null;
  }

  async hasOutboundEvidence(requestId: string): Promise<boolean> {
    return (await this.db.evidenceRecord.count({ where: { requestId, kind: 'OUTBOUND_COPY' } })) > 0;
  }

  async appendEvidenceRecord(record: EvidenceRecord): Promise<EvidenceRecord> {
    const created = await this.db.evidenceRecord.create({
      data: {
        requestId: record.requestId,
        kind: record.kind,
        sha256: record.sha256,
        prevHash: record.prevHash,
        chainHash: record.chainHash,
        qualifiedTimestampRef: record.qualifiedTimestamp?.tsaRef ?? null,
        anchorKind: record.qualifiedTimestamp?.kind ?? null,
        storageRef: record.storageRef,
      },
      select: { id: true },
    });
    // The DB-assigned id is what `provableSendEvidenceIdOf()` brands, so the id that authorises the
    // clock is the id of a row that actually exists.
    return { ...record, id: created.id };
  }

  // --- the human queue ------------------------------------------------------------------------

  /**
   * A request that could not be dispatched is queued for ops WITHOUT a state change.
   *
   * There is deliberately no `READY → NEEDS_HUMAN` edge (see channels/human-queue.ts), so this is
   * recorded as an audit event on the append-only log rather than as a transition: `fromState` and
   * `toState` are both the current state, which is the honest description — nothing moved.
   */
  async recordHumanQueueEntry(entry: { requestId: string; reason: string; queuedAt: Date }): Promise<void> {
    const r = await this.db.rightsRequest.findUnique({ where: { id: entry.requestId }, select: { state: true } });
    if (!r) return;
    await this.db.requestEvent.create({
      data: {
        requestId: entry.requestId,
        type: 'humanQueued',
        fromState: r.state,
        toState: r.state,
        actor: 'SYSTEM',
        payload: { reason: entry.reason.slice(0, 1000), queuedAt: entry.queuedAt.toISOString() },
      },
    });
  }

  /** READY requests the dispatcher should pick up. */
  async findDispatchable(limit: number): Promise<readonly string[]> {
    const rows = await this.db.rightsRequest.findMany({
      where: { state: 'READY' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Timers that should have fired. The backstop for a lost job (deadline.ts). */
  async findDueDeadlines(now: Date): Promise<readonly { requestId: string; kind: 'provisional' | 'statutory' }[]> {
    const [provisional, statutory] = await Promise.all([
      this.db.rightsRequest.findMany({
        where: { state: 'AWAITING_RESPONSE_PROVISIONAL', provisionalDeadlineAt: { lte: now } },
        select: { id: true },
      }),
      this.db.rightsRequest.findMany({
        where: { state: 'AWAITING_RESPONSE', deadlineAt: { lte: now } },
        select: { id: true },
      }),
    ]);
    return [
      ...provisional.map((r) => ({ requestId: r.id, kind: 'provisional' as const })),
      ...statutory.map((r) => ({ requestId: r.id, kind: 'statutory' as const })),
    ];
  }

  private toSnapshot(r: {
    id: string; state: string; userId: string; controllerId: string; requestType: string;
    provableSendConfirmedAt: Date | null; deadlineAt: Date | null; provisionalDeadlineAt: Date | null;
    outcome: string | null; playbook: { document: unknown };
    events?: { id?: string; type?: string; toState?: string }[];
  }): RequestSnapshot {
    const doc = r.playbook.document as { validation?: { humanReviewIfConfidenceBelow?: number } } | null;
    return {
      id: r.id,
      state: r.state as RequestSnapshot['state'],
      userId: r.userId,
      controllerId: r.controllerId,
      requestType: String(r.requestType),
      provableSendConfirmedAt: r.provableSendConfirmedAt,
      deadlineAt: r.deadlineAt,
      provisionalDeadlineAt: r.provisionalDeadlineAt,
      hasControllerResponse: (r.events ?? []).some((e) => e.type === 'responseIngested' || e.id !== undefined),
      reviewedByHuman: false,
      parseConfidence: null,
      humanReviewIfConfidenceBelow: doc?.validation?.humanReviewIfConfidenceBelow ?? 1,
      outcome: (r.outcome ?? null) as RequestSnapshot['outcome'],
    };
  }
}

/** Anchor kinds, re-exported so the persistence seam and the core union cannot drift apart. */
export type PersistedAnchorKind = TimestampAnchor['kind'];

function toVerifiedIdentity(row: {
  id: string; userId: string; status: string; method: string | null;
  legalName: string | null; dateOfBirth: Date | null; verifiedAt: Date | null; providerRef: string | null;
  addresses: { street: string; postalCode: string; city: string; country: string; current: boolean; verifiedAt: Date }[];
}): VerifiedIdentity {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as VerifiedIdentity['status'],
    method: (row.method ?? 'EID') as VerifiedIdentity['method'],
    // deriveSubject() throws on an unverified identity before these are read; the empty defaults
    // exist so a partially-filled row fails THERE, with the identity error, rather than here.
    legalName: row.legalName ?? '',
    dateOfBirth: row.dateOfBirth ?? new Date(0),
    addresses: row.addresses.map((a) => ({
      street: a.street, postalCode: a.postalCode, city: a.city, country: a.country,
      current: a.current, verifiedAt: a.verifiedAt,
    })),
    verifiedAt: row.verifiedAt,
    providerRef: row.providerRef,
  };
}
