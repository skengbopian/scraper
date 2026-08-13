/**
 * Cheapest-rung-first request routing (docs/08 guardrail 5, ADR-025; ladder-refitted by ADR-036).
 *
 * Before the request pipeline generates a legal RightsRequest, it asks this module which rung of the
 * leverage ladder to take. `planRequestCreation` is the pipeline seam and stays exactly that: the
 * NestJS service executes the plan, this module only decides. What changed in wave 4 is what sits
 * underneath it — a ladder with an explicit order and an outcome-equivalence axis (ladder.ts) and a
 * selection pass that records why each rejected rung was rejected (rungs.ts), instead of a scalar
 * comparator over matching routes.
 *
 * The decision is derived from `requestType` and `cause`, never from request input — the create DTO
 * has no outcome field, so a caller cannot steer routing (the anti-stalker/DTO discipline stays
 * intact).
 */
import {
  MECHANISM_TIER,
  requiresStatutoryInstrument,
  type ControllerType,
  type LedgerTier,
  type ProtectionOutcome,
  type RungRejection,
} from './ladder.js';
import { chooseRung, summariseDecision, type RungCandidate } from './rungs.js';
import { OUTCOME_ROUTE_TYPES, isGuidedOnly, type DesiredOutcome, type SelfServeRoute } from './self-serve.js';

export { chooseRung, summariseDecision } from './rungs.js';

/** The four statutory request types (mirrors StatutoryRequestType in the schema and the API DTO). */
export type StatutoryRequestType = 'OBJECTION_ART21' | 'ACCESS_ART15' | 'ACCESS_ART15_SOURCE' | 'ERASURE_ART17';

/** Why the request is being created. Only PROVENANCE_CHAIN changes which outcome an erasure pursues. */
export type RequestCause = 'USER_INITIATED' | 'PROVENANCE_CHAIN' | 'FRAUD_REPAIR';

export interface OutcomeForRequestInput {
  readonly requestType: StatutoryRequestType;
  readonly cause?: RequestCause;
}

/**
 * The welfare outcome a request pursues. TOTAL — every statutory type maps to something, because
 * "this instrument pursues no outcome" was never true; what was true is that most of them have no
 * self-serve equivalent, and that is now expressed by the outcome's entry in `OUTCOME_ACHIEVABLE_BY`
 * rather than by a null.
 *
 * The one place `cause` matters: an ERASURE_ART17 raised BY the provenance chain is not the same
 * instrument as a user-initiated one. It is the bounded Art. 17(1)(d) demand for the layer the
 * controller itself sourced from a broker (docs/07's single exception to "a bureau is not an erasure
 * target"), and it is achievable only by the legal rung.
 */
export function protectionOutcomeFor(input: OutcomeForRequestInput): ProtectionOutcome {
  switch (input.requestType) {
    case 'ERASURE_ART17':
      return input.cause === 'PROVENANCE_CHAIN' ? 'BROKER_SOURCED_LAYER_ERASED' : 'ERASURE';
    case 'OBJECTION_ART21':
      return 'OBJECTION_LODGED';
    case 'ACCESS_ART15':
      return 'ART15_INFORMATION_OBTAINED';
    case 'ACCESS_ART15_SOURCE':
      return 'DATA_SOURCE_DISCLOSED';
    default: {
      // Exhaustiveness: a new statutory type must be mapped deliberately, never swept silently into
      // the costly legal path. The `never` binding makes an unmapped value a compile error; the throw
      // guards a bad value that crossed a runtime boundary (a cast).
      const _exhaustive: never = input.requestType;
      throw new Error(`unmapped requestType for leverage routing: ${String(_exhaustive)}`);
    }
  }
}

/**
 * The self-serve-achievable outcome for a request type, or null where no self-serve rung applies.
 *
 * Retained with its original contract because it says something the total mapping above does not:
 * "there is nothing below the legal rung that could serve this". It is now derived rather than
 * hand-maintained — an outcome counts as self-serve-achievable exactly when route types exist for it.
 */
export function outcomeForRequestType(requestType: StatutoryRequestType): DesiredOutcome | null {
  const outcome = protectionOutcomeFor({ requestType });
  return (OUTCOME_ROUTE_TYPES as Partial<Record<ProtectionOutcome, readonly string[]>>)[outcome]
    ? (outcome as DesiredOutcome)
    : null;
}

/**
 * A LeverageAction to persist for this decision (docs/08: every user-visible action writes exactly one).
 * `tier` is a `LedgerTier`, not a `LeverageTier`: 'NONE' is the absence of a rung, so it may be written
 * to the ledger but may never be ranked against a rung (ladder.ts).
 */
export interface LeverageActionDraft {
  readonly tier: LedgerTier;
  readonly mechanism: string;
  readonly costCents: number;
  readonly outcome: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNVERIFIABLE';
  /**
   * The typed routing record: which rung was taken and why every other candidate was not. Non-personal
   * by construction (tiers, mechanisms, route refs), so it is safe in an audit row and in a
   * RequestEvent payload. Persisted to `LeverageAction.routingDecision` (migration 0007).
   */
  readonly routingDecision?: Record<string, unknown>;
}

export type RequestCreationPlan =
  | {
      readonly kind: 'PREFER_SELF_SERVE';
      readonly route: SelfServeRoute;
      readonly guided: boolean;
      readonly leverageAction: LeverageActionDraft;
      readonly reason: string;
    }
  | {
      readonly kind: 'CREATE_LEGAL';
      readonly leverageAction: LeverageActionDraft;
      readonly reason: string;
    }
  | {
      // No self-serve route AND no counsel-approved legal playbook — we cannot act. The pipeline must
      // NOT materialise a legal request with no template (CLAUDE.md: legal prose is counsel-reviewed,
      // never inlined). Surface a "not yet supported" outcome instead.
      readonly kind: 'NO_ROUTE';
      readonly leverageAction: LeverageActionDraft;
      readonly reason: string;
    };

export interface PlanRequestCreationInput {
  readonly requestType: StatutoryRequestType;
  readonly controllerSlug: string;
  readonly selfServeRoutes: readonly SelfServeRoute[];
  /** Whether a counsel-approved legal playbook exists as the fallback for this (controller, requestType). */
  readonly legalPlaybookAvailable: boolean;
  /** Why the request is being raised. Absent = USER_INITIATED. */
  readonly cause?: RequestCause;
  /** The census classification of the controller. Absent = unclassified; never guessed. */
  readonly controllerType?: ControllerType;
  /**
   * Mechanisms this user already tried against this controller without the outcome landing. Passing
   * them is what lets the next rung open by itself rather than by a support ticket.
   */
  readonly exhaustedMechanisms?: readonly string[];
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Decide whether to route the user to a self-serve rung, create a legal request, or report that we
 * cannot act. Cheapest-rung-first: the lowest rung that can ACHIEVE the outcome wins (docs/08
 * guardrail 5). The returned plan ALWAYS carries a LeverageActionDraft so the decision is recorded
 * either way, and now carries the typed rejection list with it.
 *
 * Invariants this encodes: a legal request is NOT the plan when a self-serve route achieves the
 * outcome; a legal request is NOT the plan when no counsel-approved playbook exists (that is
 * NO_ROUTE); and a self-serve route may not be substituted for a statutory instrument at a high-harm
 * controller, or for an outcome no rung below LEGAL can achieve.
 */
export function planRequestCreation(input: PlanRequestCreationInput): RequestCreationPlan {
  const outcome = protectionOutcomeFor({ requestType: input.requestType, cause: input.cause });
  const target = norm(input.controllerSlug);
  const preRejected: RungRejection[] = [];
  const candidates: RungCandidate[] = [];

  // --- Tier 1: the company's own off-switch. Only routes for THIS controller whose route type serves
  //     THIS outcome become candidates; the rest are recorded as rejected so the audit shows that a
  //     route existed and why it was not the answer.
  const servingTypes: ReadonlySet<string> = new Set(
    (OUTCOME_ROUTE_TYPES as Partial<Record<ProtectionOutcome, readonly string[]>>)[outcome] ?? [],
  );
  for (const route of input.selfServeRoutes) {
    if (norm(route.companySlug) !== target) continue;
    const ref = `${route.companySlug}:${route.routeType}`;
    if (!servingTypes.has(route.routeType)) {
      preRejected.push({ ref, tier: '1', reason: 'WRONG_OUTCOME' });
      continue;
    }
    candidates.push({ kind: 'SELF_SERVE', tier: '1', mechanism: 'SELF_SERVE_ROUTED', ref, achieves: outcome, route });
  }

  // --- The legal rung. Two reasons it may not be offered even when a playbook exists:
  const legalRef = `${target}:${input.requestType}`;
  if (!input.legalPlaybookAvailable) {
    preRejected.push({ ref: legalRef, tier: 'LEGAL', reason: 'NO_PLAYBOOK' });
  } else if (outcome === 'ERASURE' && requiresStatutoryInstrument(input.controllerType)) {
    // docs/07: a credit bureau (and equally a screener) is NOT an erasure target — the levers are
    // access, provenance, correction and retention. The single exception is the bounded Art. 17(1)(d)
    // partial erasure that follows a provenance answer, and that is a DIFFERENT outcome
    // (BROKER_SOURCED_LAYER_ERASED), so this refusal cannot swallow the flagship chain.
    preRejected.push({ ref: legalRef, tier: 'LEGAL', reason: 'INSTRUMENT_NOT_AVAILABLE_FOR_CONTROLLER' });
  } else {
    candidates.push({ kind: 'LEGAL', tier: 'LEGAL', mechanism: 'REQUEST_CREATED', ref: legalRef, achieves: outcome });
  }

  const decision = chooseRung({
    outcome,
    ...(input.controllerType !== undefined ? { controllerType: input.controllerType } : {}),
    candidates,
    exhaustedMechanisms: (input.exhaustedMechanisms ?? []).filter(
      (m): m is keyof typeof MECHANISM_TIER => m in MECHANISM_TIER,
    ),
  });
  const allRejected = [...preRejected, ...decision.rejected];
  const audit = summariseDecision(outcome, { ...decision, rejected: allRejected } as typeof decision, input.controllerType);

  if (decision.kind === 'TAKE' && decision.chosen.kind === 'SELF_SERVE') {
    const route = decision.chosen.route;
    return {
      kind: 'PREFER_SELF_SERVE',
      route,
      guided: isGuidedOnly(route),
      // Tier 1, routed (not yet completed) — the user still has to act on the guided handoff.
      // costCents 0: routing is free; a send/dispatch cost, if any, is a separate later action.
      leverageAction: { tier: '1', mechanism: 'SELF_SERVE_ROUTED', costCents: 0, outcome: 'PENDING', routingDecision: audit },
      reason: isGuidedOnly(route)
        ? 'self-serve route exists but is login-gated — present it as a guided handoff (no credential storage)'
        : "self-serve route exists — the company's own opt-out page; nothing for the controller to refuse, and cheaper than a legal request",
    };
  }
  if (decision.kind === 'TAKE') {
    return {
      kind: 'CREATE_LEGAL',
      leverageAction: { tier: 'LEGAL', mechanism: 'REQUEST_CREATED', costCents: 0, outcome: 'PENDING', routingDecision: audit },
      reason: reasonForLegal(outcome),
    };
  }
  return {
    kind: 'NO_ROUTE',
    leverageAction: { tier: 'NONE', mechanism: 'NO_ROUTE_AVAILABLE', costCents: 0, outcome: 'UNVERIFIABLE', routingDecision: audit },
    reason: reasonForNoRoute(outcome, allRejected),
  };
}

function reasonForLegal(outcome: ProtectionOutcome): string {
  switch (outcome) {
    case 'ART15_INFORMATION_OBTAINED':
      return 'no rung below the legal one can produce Art. 15(1) information — a self-serve export is a file, not the purposes, recipients, retention and source';
    case 'DATA_SOURCE_DISCLOSED':
      return 'only Art. 15(1)(g) reaches the source of the data — no self-serve route discloses a controller’s suppliers';
    case 'BROKER_SOURCED_LAYER_ERASED':
      return 'the bounded Art. 17(1)(d) erasure of the broker-sourced layer follows the provenance answer and has no self-serve equivalent';
    case 'OBJECTION_LODGED':
      return 'an Art. 21 objection has no safe self-serve equivalent while 21(1) and 21(2) are one request type';
    default:
      return 'no self-serve route achieves this outcome — legal request';
  }
}

function reasonForNoRoute(outcome: ProtectionOutcome, rejected: readonly RungRejection[]): string {
  if (rejected.some((r) => r.reason === 'INSTRUMENT_NOT_AVAILABLE_FOR_CONTROLLER')) {
    return 'erasure is not the instrument for this controller — for a credit bureau or a screener the levers are access, provenance, correction and retention (docs/07)';
  }
  if (rejected.some((r) => r.reason === 'HIGH_HARM_CONTROLLER_TYPE')) {
    return 'a self-serve page is not an acceptable substitute for the statutory instrument at this controller, and no counsel-approved playbook exists yet';
  }
  if (rejected.some((r) => r.reason === 'ALREADY_TRIED_BY_USER')) {
    return 'every available rung has already been tried for this controller without the outcome landing';
  }
  return outcome === 'ERASURE' || outcome === 'MARKETING_STOP'
    ? 'no self-serve route and no counsel-approved legal playbook'
    : 'no self-serve equivalent and no counsel-approved legal playbook for this request type';
}
