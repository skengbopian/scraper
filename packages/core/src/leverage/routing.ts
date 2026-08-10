/**
 * Cheapest-rung-first request routing (docs/08 guardrail 5, PROMPT-FEATURES step 6).
 *
 * Before the request pipeline generates a legal RightsRequest, it asks this module whether a Tier-1
 * self-serve route achieves the SAME outcome. If one does, the pipeline routes the user to a guided
 * handoff and does NOT create a legal request — there is nothing for the controller to refuse, and it is
 * cheaper and higher-yield (docs/08). Only when no self-serve route exists does it fall through to the
 * legal request. This is the pure decision layer; the NestJS service executes the plan (I/O).
 *
 * The decision is derived from `requestType`, never from request input — the create DTO has no
 * outcome field, so a caller cannot steer routing (the anti-stalker/DTO discipline stays intact).
 */
import { chooseCheapestRung, type DesiredOutcome, type SelfServeRoute } from './self-serve.js';

/** The four statutory request types (mirrors StatutoryRequestType in the schema and the API DTO). */
export type StatutoryRequestType = 'OBJECTION_ART21' | 'ACCESS_ART15' | 'ACCESS_ART15_SOURCE' | 'ERASURE_ART17';

/**
 * Map a statutory request type to the welfare outcome a self-serve route could satisfy, or null where no
 * self-serve rung applies (the legal path). Two deliberate nulls:
 *
 *  - ACCESS_ART15 / ACCESS_ART15_SOURCE: obtaining data has no self-serve equivalent.
 *  - OBJECTION_ART21: Art. 21(1) (general objection to legitimate-interest processing — the
 *    enrichment-broker profiling case, the product's primary target) and Art. 21(2) (unconditional
 *    marketing objection) are ONE enum value here; we cannot tell them apart, and a 21(1) objection has
 *    NO marketing self-serve equivalent. Routing it to a MARKETING_PREFS form would fail the user's real
 *    outcome AND falsely record it as handled. So objections always take the legal path until the
 *    sub-right is distinguished (OBJECTION_ART21_1 vs _2). `TODO(counsel)`: once distinguished, a genuine
 *    21(2) marketing objection MAY map to MARKETING_STOP.
 *
 * MARKETING_STOP / DO_NOT_SELL / ACCOUNT_DELETION / CONSENT_WITHDRAWAL are therefore not reachable
 * through this function today; they remain available to direct callers of `chooseCheapestRung`.
 */
export function outcomeForRequestType(requestType: StatutoryRequestType): DesiredOutcome | null {
  switch (requestType) {
    case 'ERASURE_ART17':
      return 'ERASURE';
    case 'OBJECTION_ART21':
      return null;
    case 'ACCESS_ART15':
    case 'ACCESS_ART15_SOURCE':
      return null;
    default: {
      // Exhaustiveness: a new statutory type must be mapped deliberately, never swept silently into the
      // costly legal path. The `never` binding makes an unmapped value a compile error; the throw guards
      // a bad value that crossed a runtime boundary (a cast).
      const _exhaustive: never = requestType;
      throw new Error(`unmapped requestType for self-serve routing: ${String(_exhaustive)}`);
    }
  }
}

/** LeverageAction tier — '0'..'5' for the ladder rungs, 'LEGAL' for the artillery, 'NONE' when we can't act. */
export type LeverageTier = '0' | '1' | '2' | '3' | '4' | '5' | 'LEGAL' | 'NONE';

/** A LeverageAction to persist for this decision (docs/08: every user-visible action writes exactly one). */
export interface LeverageActionDraft {
  readonly tier: LeverageTier;
  readonly mechanism: string;
  readonly costCents: number;
  readonly outcome: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNVERIFIABLE';
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
}

/**
 * Decide whether to route the user to a self-serve rung, create a legal request, or report that we
 * cannot act. Cheapest-rung-first: a matching self-serve route beats a legal request (docs/08 guardrail
 * 5). The returned plan ALWAYS carries a LeverageActionDraft so the decision is recorded either way.
 *
 * Invariants this encodes: a legal request is NOT the plan when a self-serve route achieves the outcome;
 * and a legal request is NOT the plan when no counsel-approved playbook exists (that is NO_ROUTE).
 */
export function planRequestCreation(input: PlanRequestCreationInput): RequestCreationPlan {
  const outcome = outcomeForRequestType(input.requestType);

  if (outcome !== null) {
    const rung = chooseCheapestRung({
      controllerSlug: input.controllerSlug,
      outcome,
      routes: input.selfServeRoutes,
      legalPlaybookAvailable: input.legalPlaybookAvailable,
    });
    if (rung.rung === 'SELF_SERVE') {
      return {
        kind: 'PREFER_SELF_SERVE',
        route: rung.route,
        guided: rung.guided,
        // Tier 1, routed (not yet completed) — the user still has to act on the guided handoff.
        // costCents 0: routing is free; a send/dispatch cost, if any, is a separate later action.
        leverageAction: { tier: '1', mechanism: 'SELF_SERVE_ROUTED', costCents: 0, outcome: 'PENDING' },
        reason: rung.reason,
      };
    }
    if (rung.rung === 'NONE') return noRoute('no self-serve route and no counsel-approved legal playbook');
    // rung.rung === 'LEGAL'
    return createLegal('no self-serve route achieves this outcome — legal request');
  }

  // Access / provenance / objection: no self-serve equivalent — legal path if a playbook exists.
  if (input.legalPlaybookAvailable) return createLegal('no self-serve equivalent for this request type — legal request');
  return noRoute('no self-serve equivalent and no counsel-approved legal playbook for this request type');
}

function createLegal(reason: string): RequestCreationPlan {
  return {
    kind: 'CREATE_LEGAL',
    leverageAction: { tier: 'LEGAL', mechanism: 'REQUEST_CREATED', costCents: 0, outcome: 'PENDING' },
    reason,
  };
}

function noRoute(reason: string): RequestCreationPlan {
  return {
    kind: 'NO_ROUTE',
    leverageAction: { tier: 'NONE', mechanism: 'NO_ROUTE_AVAILABLE', costCents: 0, outcome: 'UNVERIFIABLE' },
    reason,
  };
}
