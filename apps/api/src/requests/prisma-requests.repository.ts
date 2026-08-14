import { PrismaClient, Prisma } from '@prisma/client';
import {
  assertNoCredential,
  CONTROLLER_TYPES,
  StaleTransitionError,
  TERMINAL_STATES,
  type MandateSnapshot,
  type OpenRequestRef,
  type RequestSnapshot,
  type RequestTypeStatutory,
  type ControllerRef,
  type ProvenanceEntry,
  type SelfServeRoute,
  type TransitionResult,
  type LeverageActionRow,
} from '@scraper/core';
import type { RequestsRepository } from './requests.service.js';

const TERMINAL = [...TERMINAL_STATES] as ('COMPLIED' | 'CLOSED_FAILED' | 'WITHDRAWN')[];

/** The DB unique on idempotencyKey rejected a concurrent duplicate — a conflict, not a fault. */
export class DuplicateRequestError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`duplicate request blocked by idempotency key (${idempotencyKey})`);
    this.name = 'DuplicateRequestError';
  }
}

/**
 * The production-shaped repository: Postgres via Prisma (packages/db), replacing the in-memory dev
 * adapter behind the same port. What this adapter is careful about:
 *
 *  - Idempotency is closed at the DATABASE: `RightsRequest.idempotencyKey` is UNIQUE, so the
 *    concurrent double-insert race the in-memory adapter documents cannot produce two rows — the
 *    second insert throws P2002 and surfaces as a guard failure upstream.
 *  - `insert()` + the audit event are ONE transaction: a request row can never exist without its
 *    `guardsPass` RequestEvent (which carries the derived subject snapshot in its payload — derived
 *    values only, never body input).
 *  - `applyTransition()` persists the state change and appends the RequestEvent atomically. The
 *    events table is append-only (0001 triggers) — corrections are new rows.
 *  - Self-serve routes pass through `assertNoCredential` ON READ: this is the serialization seam the
 *    docs/08 guardrail-1 TODO(safety) in core names — a credential-shaped column smuggled into the DB
 *    fails here, not at the browser.
 *
 * Parse-confidence note: like the in-memory adapter, snapshots report `parseConfidence: null` /
 * `reviewedByHuman: false` — the validated:* caller supplies the parse context explicitly. The
 * `ControllerResponse` row (with real structured output + confidence) is written by the ingest
 * pipeline (P1), not by the state transition itself.
 */
export class PrismaRequestsRepository implements RequestsRepository {
  constructor(private readonly db: PrismaClient) {}

  async findControllerBySlug(slug: string): Promise<ControllerRef | null> {
    const c = await this.db.controller.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      select: { id: true, type: true },
    });
    // The census type drives the high-harm bypass (ADR-036). An unrecognised value reads as
    // unclassified rather than as some default — guessing would either escalate every unknown
    // controller to artillery or, worse, let a bureau look like an ordinary shop.
    if (!c) return null;
    return { id: c.id, type: (CONTROLLER_TYPES as readonly string[]).includes(c.type) ? (c.type as ControllerRef['type']) : null };
  }

  async findControllerSlugById(controllerId: string): Promise<string | null> {
    const c = await this.db.controller.findUnique({ where: { id: controllerId }, select: { slug: true } });
    return c?.slug ?? null;
  }

  /**
   * Persist the per-category rows a provenance answer yielded. One ledger per request (the model's
   * `rightsRequestId` is UNIQUE), so a re-ingest replaces its entries rather than accreting a second
   * set — two ledgers for one answer would double every follow-up proposal derived from it.
   */
  async saveProvenanceEntries(args: {
    readonly requestId: string;
    readonly userId: string;
    readonly controllerId: string;
    readonly entries: readonly ProvenanceEntry[];
  }): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const ledger = await tx.provenanceLedger.upsert({
        where: { rightsRequestId: args.requestId },
        create: { userId: args.userId, controllerId: args.controllerId, rightsRequestId: args.requestId },
        update: {},
        select: { id: true },
      });
      await tx.provenanceEntry.deleteMany({ where: { ledgerId: ledger.id } });
      await tx.provenanceEntry.createMany({
        data: args.entries.map((e) => ({
          ledgerId: ledger.id,
          dataCategory: e.dataCategory,
          statedSource: e.statedSource,
          statedLegalBasis: e.statedLegalBasis,
          isBroker: e.isBroker,
          matchedWatchlistSlug: e.matchedWatchlistSlug,
          confidence: e.confidence,
        })),
      });
    });
  }

  async loadProvenanceEntries(requestId: string): Promise<readonly ProvenanceEntry[]> {
    const ledger = await this.db.provenanceLedger.findUnique({
      where: { rightsRequestId: requestId },
      select: { entries: true },
    });
    return (ledger?.entries ?? []).map((e) => ({
      dataCategory: e.dataCategory,
      statedSource: e.statedSource,
      statedLegalBasis: e.statedLegalBasis,
      isBroker: e.isBroker,
      matchedWatchlistSlug: e.matchedWatchlistSlug,
      confidence: e.confidence,
    }));
  }

  /**
   * Mechanisms this user already tried against this controller that did not deliver (ADR-036).
   * TODO(product): no writer books `outcome: 'FAILED'` yet, so this is correct and currently always
   * empty — see the ADR. The gap is the confirmation endpoint, not this query.
   */
  async findExhaustedMechanisms(userId: string, controllerId: string): Promise<readonly string[]> {
    const rows = await this.db.leverageAction.findMany({
      where: { userId, controllerId, outcome: 'FAILED' },
      select: { mechanism: true },
      distinct: ['mechanism'],
    });
    return rows.map((r) => r.mechanism);
  }

  async findSelfServeRoutes(controllerSlug: string): Promise<readonly SelfServeRoute[]> {
    const rows = await this.db.selfServeRoute.findMany({ where: { companySlug: controllerSlug.trim().toLowerCase() } });
    return rows.map((r) => {
      const route = {
        companySlug: r.companySlug,
        routeType: r.routeType as SelfServeRoute['routeType'],
        url: r.url,
        steps: r.steps,
        requiresLogin: r.requiresLogin,
        ...(r.estMinutes !== null ? { estMinutes: r.estMinutes } : {}),
      } as unknown as SelfServeRoute;
      // docs/08 guardrail 1 at the serialization seam (core create-request.ts TODO(safety)).
      assertNoCredential(route as unknown as Record<string, unknown>);
      return route;
    });
  }

  async hasLegalPlaybook(controllerSlug: string, requestType: RequestTypeStatutory): Promise<boolean> {
    const n = await this.db.playbook.count({
      where: { active: true, requestType, controller: { slug: controllerSlug.trim().toLowerCase() } },
    });
    return n > 0;
  }

  async findLivemandates(userId: string): Promise<readonly MandateSnapshot[]> {
    const rows = await this.db.mandate.findMany({ where: { userId, revokedAt: null } });
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      scope: m.scope as unknown as MandateSnapshot['scope'],
      signedAt: m.signedAt,
      revokedAt: m.revokedAt,
    }));
  }

  async findNonTerminalSiblings(userId: string, controllerId: string, requestType: string): Promise<readonly OpenRequestRef[]> {
    const rows = await this.db.rightsRequest.findMany({
      where: { userId, controllerId, requestType: requestType as never, state: { notIn: TERMINAL } },
      select: { id: true, userId: true, controllerId: true, requestType: true },
    });
    return rows.map((r) => ({ ...r, requestType: String(r.requestType) }));
  }

  async countTerminalPredecessors(userId: string, controllerId: string, requestType: string): Promise<number> {
    return this.db.rightsRequest.count({
      where: { userId, controllerId, requestType: requestType as never, state: { in: TERMINAL } },
    });
  }

  async latestTerminalClosedAt(userId: string, controllerId: string, requestType: string): Promise<Date | null> {
    const row = await this.db.rightsRequest.findFirst({
      where: { userId, controllerId, requestType: requestType as never, state: { in: TERMINAL } },
      orderBy: { closedAt: 'desc' },
      select: { closedAt: true },
    });
    return row?.closedAt ?? null;
  }

  async insert(row: Record<string, unknown>): Promise<{ id: string }> {
    const controllerId = String(row.controllerId);
    const requestType = String(row.requestType);
    // RightsRequest.playbookId is a required FK: resolve the active playbook the routing decision
    // just asserted exists. Losing the race (deactivated in between) is an invariant violation.
    const pb = await this.db.playbook.findFirst({
      where: { controllerId, requestType: requestType as never, active: true },
      select: { id: true, document: true },
    });
    if (!pb) throw new Error(`insert: no active playbook for (${controllerId}, ${requestType}) — routing said there was one`);
    const doc = pb.document as { channel?: { primary?: string }; scopeSource?: string } | null;

    // Scope binding is checked in BOTH directions at the moment the request binds to a playbook
    // (audit P3). The engine's render-time refusal already exists; this closes the window where an
    // active-but-unbounded ERASURE_ART17 playbook at a bureau (e.g. a copied fixture) would bind to
    // a provenance-chain follow-up, whose entire legal theory is the BOUNDED Art. 17(1)(d) demand.
    const cause = String(row.cause ?? 'USER_INITIATED');
    if (cause === 'PROVENANCE_CHAIN' && requestType === 'ERASURE_ART17' && doc?.scopeSource !== 'PROVENANCE_ANSWER') {
      throw new Error(
        `insert: the provenance-chain erasure for (${controllerId}) resolved to a playbook WITHOUT ` +
          `scopeSource: PROVENANCE_ANSWER — refusing to bind. An unbounded erasure demand at a bureau ` +
          'is the letter docs/07 forbids; activate the bounded loeschung-herkunft playbook instead.',
      );
    }
    if (doc?.scopeSource !== undefined && cause !== 'PROVENANCE_CHAIN') {
      throw new Error(
        `insert: playbook for (${controllerId}, ${requestType}) declares scopeSource ${doc.scopeSource} ` +
          `but the request cause is ${cause} — a bounded-scope letter has no scope to be bounded BY ` +
          'outside the provenance chain.',
      );
    }

    const channel = (doc?.channel?.primary === 'postal' || doc?.channel?.primary === 'web_form' ? doc.channel.primary : 'email') as
      | 'email'
      | 'postal'
      | 'web_form';

    try {
      const [created] = await this.db.$transaction([
        this.db.rightsRequest.create({
          data: {
            id: String(row.id),
            userId: String(row.userId),
            controllerId,
            playbookId: pb.id,
            requestType: requestType as never,
            cause: String(row.cause ?? 'USER_INITIATED') as never,
            state: 'READY',
            channel,
            cycleOrdinal: Number(row.cycleOrdinal ?? 1),
            idempotencyKey: String(row.idempotencyKey),
          },
          select: { id: true },
        }),
        this.db.requestEvent.create({
          data: {
            requestId: String(row.id),
            type: 'guardsPass',
            fromState: 'DRAFT',
            toState: 'READY',
            actor: 'SYSTEM',
            // The derived subject snapshot — audit trail of WHOSE data this request is about,
            // guaranteed derived from the verified identity (guards ran before insert).
            payload: {
              subjectLegalName: String(row.subjectLegalName ?? ''),
              subjectDateOfBirth: row.subjectDateOfBirth instanceof Date ? row.subjectDateOfBirth.toISOString() : String(row.subjectDateOfBirth ?? ''),
              subjectIdentityId: String(row.subjectIdentityId ?? ''),
            },
          },
        }),
      ]);
      return { id: created.id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // The UNIQUE idempotencyKey closed the concurrent double-insert race (docs/03 §Idempotency).
        // A typed error so the service maps the LOSING racer to the same GUARD_IDEMPOTENCY conflict
        // the sequential path produces — not a 500 (audit W12).
        throw new DuplicateRequestError(String(row.idempotencyKey));
      }
      throw e;
    }
  }

  async recordLeverageAction(row: LeverageActionRow): Promise<void> {
    await this.db.leverageAction.create({
      data: {
        userId: row.userId,
        controllerId: row.controllerId ?? null,
        tier: String(row.tier),
        mechanism: row.mechanism,
        costCents: row.costCents,
        outcome: row.outcome,
        ...(row.routingDecision ? { routingDecision: row.routingDecision as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async load(id: string): Promise<(RequestSnapshot & { userId: string }) | null> {
    const r = await this.db.rightsRequest.findUnique({
      where: { id },
      include: {
        playbook: { select: { document: true } },
        events: { where: { type: 'responseIngested' }, select: { id: true }, take: 1 },
      },
    });
    if (!r) return null;
    return this.toSnapshot(r);
  }

  async listByUser(userId: string): Promise<readonly (RequestSnapshot & { userId: string })[]> {
    const rows = await this.db.rightsRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        playbook: { select: { document: true } },
        events: { where: { type: 'responseIngested' }, select: { id: true }, take: 1 },
      },
    });
    return rows.map((r) => this.toSnapshot(r));
  }

  async applyTransition(id: string, result: unknown): Promise<void> {
    const t = result as TransitionResult;
    const p = t.patch;
    const data: Record<string, unknown> = { state: t.to };
    if (p.deadlineAt !== undefined) data.deadlineAt = p.deadlineAt;
    if (p.provisionalDeadlineAt !== undefined) data.provisionalDeadlineAt = p.provisionalDeadlineAt;
    if (p.provableSendConfirmedAt !== undefined) data.provableSendConfirmedAt = p.provableSendConfirmedAt;
    if (p.outcome !== undefined) data.outcome = p.outcome;
    if (p.closedAt !== undefined) data.closedAt = p.closedAt;
    if (t.event === 'dispatch') data.sentAt = t.at;
    await this.db.$transaction(async (tx) => {
      // Compare-and-swap on the from-state. The snapshot this transition was computed from may be
      // stale (worker sweep vs. queued job, double-submitted action); a blind write would record a
      // second READY→SENT in the append-only log and let both racers reach the wire. Losing the
      // race is an error the caller can see, never a silent overwrite.
      const updated = await tx.rightsRequest.updateMany({ where: { id, state: t.from as never }, data: data as never });
      if (updated.count === 0) {
        throw new StaleTransitionError(id, t.from, `"${t.event}" was computed from a stale snapshot`);
      }
      await tx.requestEvent.create({
        data: {
          requestId: id,
          type: t.event,
          fromState: t.from,
          toState: t.to,
          actor: t.actor,
          // The reason is what an ops reviewer reads to decide. Dropping it made NEEDS_HUMAN
          // tickets arrive with an empty explanation (ADR-037).
          payload: { note: t.note ?? null, ...(t.reason ? { reason: t.reason } : {}) },
        },
      });
    });
  }

  private toSnapshot(r: {
    id: string; state: string; userId: string; controllerId: string; requestType: string;
    provableSendConfirmedAt: Date | null; deadlineAt: Date | null; provisionalDeadlineAt: Date | null;
    outcome: string | null; playbook: { document: unknown } | null; events: { id: string }[];
  }): RequestSnapshot & { userId: string } {
    const doc = r.playbook?.document as { validation?: { humanReviewIfConfidenceBelow?: number } } | null;
    return {
      id: r.id,
      state: r.state as RequestSnapshot['state'],
      userId: r.userId,
      controllerId: r.controllerId,
      requestType: String(r.requestType),
      provableSendConfirmedAt: r.provableSendConfirmedAt,
      deadlineAt: r.deadlineAt,
      provisionalDeadlineAt: r.provisionalDeadlineAt,
      hasControllerResponse: r.events.length > 0,
      reviewedByHuman: false,
      parseConfidence: null,
      humanReviewIfConfidenceBelow: doc?.validation?.humanReviewIfConfidenceBelow ?? 1,
      outcome: (r.outcome ?? null) as RequestSnapshot['outcome'],
    };
  }
}
