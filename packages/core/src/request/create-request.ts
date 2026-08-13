/**
 * The rights-request creation orchestration, as a pure, framework-free function.
 *
 * It was extracted from the NestJS service so the whole flow — cheapest-rung-first routing, the
 * anti-stalker identity binding, the guard sequence, idempotency, and the insert — is unit-testable with
 * a fake repository, without a database or NestJS. The service becomes a thin adapter that maps the
 * result union to HTTP responses/exceptions. This is what makes "a legal request is NOT created when a
 * self-serve route exists" a BEHAVIOURAL guarantee (insert is never called), not just a source-scan.
 *
 * It performs I/O through the injected port but takes no framework dependency and returns RESULTS rather
 * than throwing for business outcomes, so every branch is observable in a test.
 */
import { createHash } from 'node:crypto';
import type { VerifiedIdentity } from '../identity/subject.js';
import {
  nextCycleOrdinal,
  runGuards,
  type MandateSnapshot,
  type OpenRequestRef,
  type RequestTypeStatutory,
} from '../state-machine/guards.js';
import { planRequestCreation, type LeverageActionDraft, type StatutoryRequestType } from '../leverage/routing.js';
import type { ControllerType } from '../leverage/ladder.js';
import type { SelfServeRoute } from '../leverage/self-serve.js';

export interface LeverageActionRow extends LeverageActionDraft {
  readonly userId: string;
  readonly controllerId: string;
}

/** The persistence port the creation flow needs. A DB adapter (or a fake, in tests) implements it. */
/** What the pipeline needs to know about the target controller. `type` drives the high-harm bypass. */
export interface ControllerRef {
  readonly id: string;
  /** Census classification. `null` = unclassified — never guessed into a high-harm default. */
  readonly type: ControllerType | null;
}

export interface CreateRequestPort {
  findControllerBySlug(slug: string): Promise<ControllerRef | null>;
  // TODO(safety): the DB/JSON adapter implementing this MUST pass every route through
  // `assertNoCredential` before returning it — that is the ingestion seam the guardrail was written for
  // (docs/08 guardrail 1). Today routes are code-seeded and the type + source-scan test forbid a
  // credential field; the runtime check becomes load-bearing once routes cross a serialization boundary.
  findSelfServeRoutes(controllerSlug: string): Promise<readonly SelfServeRoute[]>;
  hasLegalPlaybook(controllerSlug: string, requestType: RequestTypeStatutory): Promise<boolean>;
  findLivemandates(userId: string): Promise<readonly MandateSnapshot[]>;
  findNonTerminalSiblings(userId: string, controllerId: string, requestType: string): Promise<readonly OpenRequestRef[]>;
  countTerminalPredecessors(userId: string, controllerId: string, requestType: string): Promise<number>;
  /**
   * Leverage mechanisms this user already took against this controller that did NOT deliver. Read from
   * the LeverageAction ledger. This is what opens the next rung without a support ticket: a user who
   * completed the broker's own removal form and is still listed reaches the legal rung by carrying on.
   *
   * TODO(product): nothing WRITES `outcome: 'FAILED'` yet — routing only ever books PENDING or
   * UNVERIFIABLE, and the docs/08 §2 "did it work?" confirmation that would book a failure is not an
   * endpoint yet. Until it is, this correctly returns nothing and the next rung stays closed (ADR-036).
   */
  findExhaustedMechanisms(userId: string, controllerId: string): Promise<readonly string[]>;
  insert(row: Record<string, unknown>): Promise<{ id: string }>;
  recordLeverageAction(row: LeverageActionRow): Promise<void>;
}

export interface CreateRequestInput {
  readonly userId: string;
  readonly identity: VerifiedIdentity;
  readonly controllerSlug: string;
  readonly requestType: StatutoryRequestType;
  readonly cause: 'USER_INITIATED' | 'PROVENANCE_CHAIN' | 'FRAUD_REPAIR';
}

export interface SelfServeRouteView {
  readonly companySlug: string;
  readonly url: string;
  readonly steps: readonly string[];
  readonly requiresLogin: boolean;
}

export type CreateRequestResult =
  | { readonly kind: 'CONTROLLER_NOT_FOUND'; readonly controllerSlug: string }
  | { readonly kind: 'IDENTITY_MISMATCH' }
  | { readonly kind: 'SELF_SERVE'; readonly route: SelfServeRouteView; readonly guided: boolean; readonly reason: string }
  | { readonly kind: 'NO_ROUTE'; readonly reason: string }
  | { readonly kind: 'GUARD_FAILED'; readonly failed: 'identity' | 'mandate' | 'idempotency'; readonly reason: string }
  | { readonly kind: 'CREATED'; readonly id: string };

export interface CreateRequestOpts {
  readonly now: Date;
  /** Injected so the function is deterministic (the service derives it from the clock). */
  readonly requestId: string;
}

/**
 * Orchestrate creation. Returns a result union; the caller maps it to a response/exception. The order is
 * load-bearing: controller → identity binding → cheapest-rung plan → (short-circuit) → guards → insert.
 * A legal request is materialised ONLY on the CREATE_LEGAL plan AND passing guards; the self-serve /
 * no-route arms return before `insert` is ever reached.
 */
export async function createRequest(
  port: CreateRequestPort,
  input: CreateRequestInput,
  opts: CreateRequestOpts,
): Promise<CreateRequestResult> {
  const controller = await port.findControllerBySlug(input.controllerSlug);
  if (!controller) return { kind: 'CONTROLLER_NOT_FOUND', controllerSlug: input.controllerSlug };
  const controllerId = controller.id;

  // Anti-stalker keystone: the endpoint verifies status==VERIFIED but not that the identity belongs to
  // THIS user. runGuards re-checks it on the legal path; the short-circuit paths do not run guards, so
  // assert it here for every path.
  if (input.identity.userId !== input.userId) return { kind: 'IDENTITY_MISMATCH' };

  const plan = planRequestCreation({
    requestType: input.requestType,
    controllerSlug: input.controllerSlug,
    selfServeRoutes: await port.findSelfServeRoutes(input.controllerSlug),
    legalPlaybookAvailable: await port.hasLegalPlaybook(input.controllerSlug, input.requestType),
    // `cause` is what distinguishes a user-initiated erasure from the bounded Art. 17(1)(d) demand the
    // provenance chain raises — two different outcomes, and only the second is lawful at a bureau.
    cause: input.cause,
    ...(controller.type !== null ? { controllerType: controller.type } : {}),
    exhaustedMechanisms: await port.findExhaustedMechanisms(input.userId, controllerId),
  });

  if (plan.kind === 'PREFER_SELF_SERVE') {
    await port.recordLeverageAction({ userId: input.userId, controllerId, ...plan.leverageAction });
    return {
      kind: 'SELF_SERVE',
      route: { companySlug: plan.route.companySlug, url: plan.route.url, steps: plan.route.steps, requiresLogin: plan.route.requiresLogin },
      guided: plan.guided,
      reason: plan.reason,
    };
  }
  if (plan.kind === 'NO_ROUTE') {
    await port.recordLeverageAction({ userId: input.userId, controllerId, ...plan.leverageAction });
    return { kind: 'NO_ROUTE', reason: plan.reason };
  }

  // CREATE_LEGAL. Guards run on every entry to READY (invariant 1); the subject comes from the guard
  // result, so there is no separate un-guarded derivation.
  const guards = runGuards({
    requestId: opts.requestId,
    userId: input.userId,
    controllerId,
    requestType: input.requestType,
    identity: input.identity,
    mandates: await port.findLivemandates(input.userId),
    nonTerminalSiblings: await port.findNonTerminalSiblings(input.userId, controllerId, input.requestType),
    now: opts.now,
  });
  // A guard rejection is not a leverage-ladder action, so it deliberately writes NO LeverageAction — it
  // is captured as a RequestEvent / log, not welfare telemetry. The SELF_SERVE / NO_ROUTE / CREATE_LEGAL
  // arms each record exactly one.
  if (!guards.ok) return { kind: 'GUARD_FAILED', failed: guards.failed, reason: guards.reason };

  // NOTE: the Art. 12(5) "excessive" re-exercise cooling (minReExerciseDays between two cycles of the
  // same request) is NOT enforced here — it is OQ-9 (counsel sets the number). Until then, a new cycle is
  // allowed as soon as the previous one is terminal. `guards.ts` exports `mayOpenNewCycle` to wire it in.
  const cycleOrdinal = nextCycleOrdinal(
    await port.countTerminalPredecessors(input.userId, controllerId, input.requestType),
  );
  const idempotencyKey = createHash('sha256')
    .update(`${input.userId}|${controllerId}|${input.requestType}|${cycleOrdinal}`)
    .digest('hex');

  const { id } = await port.insert({
    id: opts.requestId,
    userId: input.userId,
    controllerId,
    requestType: input.requestType,
    cause: input.cause,
    state: 'READY',
    cycleOrdinal,
    idempotencyKey,
    // The subject snapshot: derived (guarded) values only, never body input.
    subjectLegalName: guards.subject.legalName,
    subjectDateOfBirth: guards.subject.dateOfBirth,
    subjectIdentityId: guards.subject.identityId,
  });
  await port.recordLeverageAction({ userId: input.userId, controllerId, ...plan.leverageAction });
  return { kind: 'CREATED', id };
}
