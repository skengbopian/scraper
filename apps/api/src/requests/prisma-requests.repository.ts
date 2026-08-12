import { PrismaClient, Prisma } from '@prisma/client';
import {
  assertNoCredential,
  TERMINAL_STATES,
  type MandateSnapshot,
  type OpenRequestRef,
  type RequestSnapshot,
  type RequestTypeStatutory,
  type SelfServeRoute,
  type TransitionResult,
  type LeverageActionRow,
} from '@scraper/core';
import type { RequestsRepository } from './requests.service.js';

const TERMINAL = [...TERMINAL_STATES] as ('COMPLIED' | 'CLOSED_FAILED' | 'WITHDRAWN')[];

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

  async findControllerIdBySlug(slug: string): Promise<string | null> {
    const c = await this.db.controller.findUnique({ where: { slug: slug.trim().toLowerCase() }, select: { id: true } });
    return c?.id ?? null;
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
    const doc = pb.document as { channel?: { primary?: string } } | null;
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
        throw new Error(`duplicate request blocked by idempotency key (${row.idempotencyKey})`);
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
    await this.db.$transaction([
      this.db.rightsRequest.update({ where: { id }, data: data as never }),
      this.db.requestEvent.create({
        data: {
          requestId: id,
          type: t.event,
          fromState: t.from,
          toState: t.to,
          actor: t.actor,
          payload: { note: t.note ?? null },
        },
      }),
    ]);
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
