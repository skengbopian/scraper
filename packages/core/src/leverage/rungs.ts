/**
 * Rung selection: given the rungs available for a (controller, outcome), decide which one to take and
 * record why the others were not (ADR-036, port wave 4).
 *
 * This replaces a pure scalar comparator. The order of the filters is load-bearing, because the
 * recorded rejection reason should be the most specific TRUE one: a credit bureau's self-serve page is
 * rejected as HIGH_HARM_CONTROLLER_TYPE, not as "no route matched", so a reviewer reading the audit
 * record learns the doctrine rather than a symptom.
 *
 * ## What is deliberately absent
 *
 * The pre-audit line ranked eligible rungs by ladder order and then walked the list backwards,
 * dropping any rung where `cost(i) >= p(i) * E[i+1]` — "trying this first is not worth the delay".
 * That walk is NOT ported, and not only because its cost inputs are (see ladder.ts on the idempotency
 * price). It does not survive having them removed: the walk seeds `expected` from the LAST (most
 * expensive) rung and keeps a cheaper rung only when `cost(i) < p(i) * expected`. Zero every cost and
 * the test becomes `0 < p * 0`, which is false for every rung — so every cheaper rung is dropped and
 * the router returns the artillery, every time, complete with a plausible-looking audit trail
 * explaining that the cheap rungs were "not worth trying first". Uniform non-zero stubs invert it
 * identically, since `c < p*c` is false for any p < 1.
 *
 * So the rule here is the doctrine unmodified: **take the lowest eligible rung**. Skipping a rung is
 * something we will earn the right to do when the ledger has observed success rates (docs/08 §1's
 * rollup); until then, guessing which cheap rung is not worth trying is exactly the judgement the
 * absent data was supposed to inform.
 */
import {
  ladderRank,
  MECHANISM_TIER,
  requiresStatutoryInstrument,
  tierCanAchieve,
  type ControllerType,
  type LedgerTier,
  type LeverageMechanism,
  type LeverageTier,
  type ProtectionOutcome,
  type RungRejection,
  type RungRejectionReason,
} from './ladder.js';
import { isGuidedOnly, type SelfServeRoute } from './self-serve.js';

/** A rung that could be taken for this (controller, outcome). */
export type RungCandidate =
  | {
      readonly kind: 'SELF_SERVE';
      readonly tier: LeverageTier;
      readonly mechanism: LeverageMechanism;
      /** Stable, non-personal identifier for the audit record. */
      readonly ref: string;
      readonly achieves: ProtectionOutcome;
      readonly route: SelfServeRoute;
    }
  | {
      readonly kind: 'LEGAL';
      readonly tier: 'LEGAL';
      readonly mechanism: LeverageMechanism;
      readonly ref: string;
      readonly achieves: ProtectionOutcome;
    };

export interface ChooseRungInput {
  readonly outcome: ProtectionOutcome;
  /** The census classification of the target controller. `undefined` = unclassified, never assumed. */
  readonly controllerType?: ControllerType;
  readonly candidates: readonly RungCandidate[];
  /**
   * Mechanisms THIS user already took against THIS controller for this outcome without it delivering.
   * Removing them is what unlocks the next rung without a support ticket: a user who completed the
   * broker's own removal form and is still in the file should reach the legal rung by continuing to
   * use the product, not by emailing us.
   */
  readonly exhaustedMechanisms?: readonly LeverageMechanism[];
}

export type RungDecision =
  | { readonly kind: 'TAKE'; readonly chosen: RungCandidate; readonly rejected: readonly RungRejection[] }
  | { readonly kind: 'NONE'; readonly rejected: readonly RungRejection[] };

export class LadderIntegrityError extends Error {}

/**
 * Choose the lowest eligible rung.
 *
 * Eligibility, in order: the candidate must actually pursue the requested outcome; its tier must be
 * one the outcome can be achieved by at all; the controller must not be one where only the statutory
 * instrument will do; and the user must not already have tried and exhausted it.
 */
export function chooseRung(input: ChooseRungInput): RungDecision {
  const rejected: RungRejection[] = [];
  const reject = (c: RungCandidate, reason: RungRejectionReason): void => {
    rejected.push({ ref: c.ref, tier: c.tier, reason });
  };
  const exhausted = new Set(input.exhaustedMechanisms ?? []);
  const highHarm = requiresStatutoryInstrument(input.controllerType);

  const eligible: RungCandidate[] = [];
  for (const c of input.candidates) {
    // A mechanism may only ever be booked against its own rung, or "outcomes per euro per tier" — the
    // number docs/08 says steers the business — becomes whatever the caller felt like crediting.
    if (MECHANISM_TIER[c.mechanism] !== (c.tier as LedgerTier)) {
      throw new LadderIntegrityError(
        `mechanism ${c.mechanism} belongs to tier ${MECHANISM_TIER[c.mechanism]}, not ${c.tier}`,
      );
    }
    if (c.achieves !== input.outcome) {
      reject(c, 'WRONG_OUTCOME');
      continue;
    }
    if (!tierCanAchieve(c.tier, input.outcome)) {
      // The structural one: e.g. a self-serve export claiming to discharge Art. 15, or a bureau's
      // "delete my account" page claiming to be the bounded Art. 17(1)(d) partial erasure.
      reject(c, 'TIER_CANNOT_ACHIEVE_OUTCOME');
      continue;
    }
    if (highHarm && c.tier !== 'LEGAL') {
      reject(c, 'HIGH_HARM_CONTROLLER_TYPE');
      continue;
    }
    if (exhausted.has(c.mechanism)) {
      reject(c, 'ALREADY_TRIED_BY_USER');
      continue;
    }
    eligible.push(c);
  }

  if (eligible.length === 0) return { kind: 'NONE', rejected };

  // LADDER ORDER FIRST. Within a rung, the caller's own preference decides — for self-serve that is
  // "no login, then observed success rate, then fewest minutes" (self-serve.ts). `ref` last so the
  // choice is deterministic and a test cannot pass by accident of array order.
  const sorted = [...eligible].sort(
    (a, b) =>
      ladderRank(a.tier) - ladderRank(b.tier) ||
      withinRung(a, b) ||
      a.ref.localeCompare(b.ref),
  );
  return { kind: 'TAKE', chosen: sorted[0]!, rejected };
}

/** Tie-break inside one rung. Only self-serve has an intra-rung preference today. */
function withinRung(a: RungCandidate, b: RungCandidate): number {
  if (a.kind !== 'SELF_SERVE' || b.kind !== 'SELF_SERVE') return 0;
  if (isGuidedOnly(a.route) !== isGuidedOnly(b.route)) return isGuidedOnly(a.route) ? 1 : -1;
  const sa = a.route.successRate ?? 0;
  const sb = b.route.successRate ?? 0;
  if (sa !== sb) return sb - sa;
  return (a.route.estMinutes ?? Number.MAX_SAFE_INTEGER) - (b.route.estMinutes ?? Number.MAX_SAFE_INTEGER);
}

/**
 * The audit record written alongside the LeverageAction. Non-personal by construction — outcome,
 * tiers, mechanisms and route refs only, no subject fields and no free text — so it satisfies the
 * RequestEvent payload contract too.
 */
export function summariseDecision(
  outcome: ProtectionOutcome,
  decision: RungDecision,
  controllerType?: ControllerType,
): Record<string, unknown> {
  const base = {
    outcome,
    controllerType: controllerType ?? null,
    rejected: decision.rejected.map((r) => ({ ref: r.ref, tier: r.tier, reason: r.reason })),
  };
  if (decision.kind === 'NONE') return { ...base, kind: 'NONE' };
  return {
    ...base,
    kind: 'TAKE',
    chosenRef: decision.chosen.ref,
    chosenTier: decision.chosen.tier,
    chosenMechanism: decision.chosen.mechanism,
  };
}
