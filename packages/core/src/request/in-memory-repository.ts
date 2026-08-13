/**
 * An in-memory reference adapter for the request pipeline (docs/10: booting the engine).
 *
 * It implements `CreateRequestPort` (plus `load`/`applyTransition`) with plain Maps, so the whole create
 * wiring — cheapest-rung-first routing, identity binding, guards, idempotency, insert — RUNS end to end
 * without a database or NestJS. It is what the engine-e2e test and the demo script assemble, and it can
 * back the NestJS `RequestsService` as a dev provider (a Postgres adapter replaces it in production).
 *
 * It is a DEV/DEMO adapter: no persistence, no encryption, no residency guarantees. Do not use it for
 * real user data.
 */
import { assertNoCredential, type SelfServeRoute } from '../leverage/self-serve.js';
import type { ControllerRef, CreateRequestPort, LeverageActionRow } from './create-request.js';
import type { MandateSnapshot, OpenRequestRef, RequestTypeStatutory } from '../state-machine/guards.js';
import type { RequestSnapshot, TransitionResult } from '../state-machine/machine.js';
import type { ProvenanceEntry } from '../provenance/ledger.js';

const TERMINAL: ReadonlySet<string> = new Set(['COMPLIED', 'CLOSED_FAILED', 'WITHDRAWN']);
const norm = (s: string): string => s.trim().toLowerCase();

export interface InMemorySeed {
  readonly controllers: readonly { readonly slug: string; readonly id: string; readonly type?: ControllerRef['type'] }[];
  readonly selfServeRoutes: readonly SelfServeRoute[];
  /** (controllerSlug, requestType) pairs that have a counsel-approved ACTIVE legal playbook. Since every
   *  shipped playbook is active:false, real controllers have none here — a demo may add a fixture pair to
   *  exercise the CREATE_LEGAL path without activating a real playbook. */
  readonly activePlaybooks: readonly { readonly controllerSlug: string; readonly requestType: RequestTypeStatutory }[];
  readonly mandates: readonly MandateSnapshot[];
}

export class InMemoryRequestsRepository implements CreateRequestPort {
  private readonly controllers = new Map<string, ControllerRef>();
  private readonly routes: readonly SelfServeRoute[];
  private readonly playbooks = new Set<string>();
  private readonly mandates: readonly MandateSnapshot[];
  private readonly requests = new Map<string, RequestSnapshot>();
  private readonly leverage: LeverageActionRow[] = [];
  private readonly provenance = new Map<string, readonly ProvenanceEntry[]>();

  constructor(seed: InMemorySeed) {
    for (const c of seed.controllers) this.controllers.set(norm(c.slug), { id: c.id, type: c.type ?? null });
    this.routes = seed.selfServeRoutes;
    for (const p of seed.activePlaybooks) this.playbooks.add(`${norm(p.controllerSlug)}|${p.requestType}`);
    this.mandates = seed.mandates;
  }

  async findControllerBySlug(slug: string): Promise<ControllerRef | null> {
    return this.controllers.get(norm(slug)) ?? null;
  }
  async findControllerSlugById(controllerId: string): Promise<string | null> {
    for (const [slug, ref] of this.controllers) if (ref.id === controllerId) return slug;
    return null;
  }
  async saveProvenanceEntries(args: {
    readonly requestId: string;
    readonly userId: string;
    readonly controllerId: string;
    readonly entries: readonly ProvenanceEntry[];
  }): Promise<void> {
    this.provenance.set(args.requestId, args.entries);
  }
  async loadProvenanceEntries(requestId: string): Promise<readonly ProvenanceEntry[]> {
    return this.provenance.get(requestId) ?? [];
  }
  /**
   * Ledger-derived: a mechanism this user took against this controller whose outcome came back FAILED.
   * TODO(product): nothing books a FAILED outcome yet (ADR-036), so this is always empty today.
   */
  async findExhaustedMechanisms(userId: string, controllerId: string): Promise<readonly string[]> {
    return [
      ...new Set(
        this.leverage
          .filter((a) => a.userId === userId && a.controllerId === controllerId && a.outcome === 'FAILED')
          .map((a) => a.mechanism),
      ),
    ];
  }
  async findSelfServeRoutes(controllerSlug: string): Promise<readonly SelfServeRoute[]> {
    const t = norm(controllerSlug);
    const matches = this.routes.filter((r) => norm(r.companySlug) === t);
    // Enforce the docs/08 guardrail-1 credential check at the port boundary (create-request.ts TODO(safety))
    // so the eventual Prisma/JSON adapter is safe-by-default rather than by copy-paste discipline.
    for (const r of matches) assertNoCredential(r as unknown as Record<string, unknown>);
    return matches;
  }
  async hasLegalPlaybook(controllerSlug: string, requestType: RequestTypeStatutory): Promise<boolean> {
    return this.playbooks.has(`${norm(controllerSlug)}|${requestType}`);
  }
  async findLivemandates(userId: string): Promise<readonly MandateSnapshot[]> {
    return this.mandates.filter((m) => m.userId === userId && m.revokedAt === null);
  }
  async findNonTerminalSiblings(userId: string, controllerId: string, requestType: string): Promise<readonly OpenRequestRef[]> {
    return [...this.requests.values()]
      .filter((r) => r.userId === userId && r.controllerId === controllerId && r.requestType === requestType && !TERMINAL.has(r.state))
      .map((r) => ({ id: r.id, userId: r.userId, controllerId: r.controllerId, requestType: r.requestType }));
  }
  async countTerminalPredecessors(userId: string, controllerId: string, requestType: string): Promise<number> {
    return [...this.requests.values()].filter(
      (r) => r.userId === userId && r.controllerId === controllerId && r.requestType === requestType && TERMINAL.has(r.state),
    ).length;
  }
  async insert(row: Record<string, unknown>): Promise<{ id: string }> {
    // NOTE: the dev adapter enforces idempotency entirely via findNonTerminalSiblings; it does NOT
    // persist the row's `idempotencyKey` or subject snapshot. The production Prisma adapter MUST add a
    // UNIQUE constraint on `idempotencyKey` to close the concurrent double-insert race (docs/03 §Idempotency).
    const id = String(row.id);
    this.requests.set(id, {
      id,
      state: (row.state as RequestSnapshot['state']) ?? 'READY',
      userId: String(row.userId),
      controllerId: String(row.controllerId),
      requestType: String(row.requestType),
      provableSendConfirmedAt: null,
      deadlineAt: null,
      provisionalDeadlineAt: null,
      hasControllerResponse: false,
      reviewedByHuman: false,
      parseConfidence: null,
      humanReviewIfConfidenceBelow: 1,
      outcome: null,
    });
    return { id };
  }
  async recordLeverageAction(row: LeverageActionRow): Promise<void> {
    this.leverage.push(row);
  }

  // Beyond CreateRequestPort, so this can also back the full RequestsRepository (other endpoints).
  async load(id: string): Promise<(RequestSnapshot & { userId: string }) | null> {
    return this.requests.get(id) ?? null;
  }
  async applyTransition(id: string, result: unknown): Promise<void> {
    const r = this.requests.get(id);
    if (!r) throw new Error(`applyTransition: unknown request ${id} — a missing request during a transition is an invariant violation`);
    const t = result as TransitionResult;
    const p = t.patch;
    // Merge only the known RequestSnapshot fields (patch may also carry closedAt, which is not on the
    // snapshot); `!== undefined` preserves an explicit null in the patch.
    this.requests.set(id, {
      ...r,
      state: t.to,
      deadlineAt: p.deadlineAt !== undefined ? p.deadlineAt : r.deadlineAt,
      provisionalDeadlineAt: p.provisionalDeadlineAt !== undefined ? p.provisionalDeadlineAt : r.provisionalDeadlineAt,
      provableSendConfirmedAt: p.provableSendConfirmedAt !== undefined ? p.provableSendConfirmedAt : r.provableSendConfirmedAt,
      outcome: p.outcome !== undefined ? p.outcome : r.outcome,
      // A controller reply proves receipt (invariant 3b reads this flag) — record it on the ingest
      // edge itself so no caller can forget to set it.
      hasControllerResponse: t.event === 'responseIngested' ? true : r.hasControllerResponse,
    });
  }

  /** All requests for one user, insertion-ordered. Backs GET /requests (the Vorgänge list). */
  async listByUser(userId: string): Promise<readonly (RequestSnapshot & { userId: string })[]> {
    return [...this.requests.values()].filter((r) => r.userId === userId);
  }

  // --- inspection, for demos and tests ---
  get leverageActions(): readonly LeverageActionRow[] {
    return this.leverage;
  }
  get allRequests(): readonly RequestSnapshot[] {
    return [...this.requests.values()];
  }
}
