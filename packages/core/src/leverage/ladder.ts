/**
 * The leverage ladder as a data structure — the part of the pre-audit line's router that was worth
 * having (ADR-036, port wave 4).
 *
 * The doctrine (docs/08): consumer welfare is not deletion count. "Always take the cheapest rung that
 * achieves the outcome" is two claims, and this file carries the second one, which is the one the
 * previous router had no way to express:
 *
 *   - CHEAPEST is an ORDER OVER RUNGS, not a scalar. Sorting candidates by cost inverts the doctrine:
 *     an Art. 21(2) objection sent by email costs about a cent in postage, which ranks it BELOW a
 *     guided self-serve handoff and makes the router reach for the statutory instrument by default.
 *     A ladder is climbed rung by rung; cost decides which rungs to SKIP, never which direction to go.
 *   - ACHIEVES is a hard constraint, not a preference. A controller's "download your data" button
 *     returns a file; Art. 15(1) obliges the purposes, the recipients, the retention period and the
 *     source. They are not the same outcome, so no ordering — however cheap — may substitute one for
 *     the other. `OUTCOME_ACHIEVABLE_BY` is what makes that a rejection rather than a judgement call.
 *
 * Deliberately NOT ported from the pre-audit line: its cost model. That file prices a legal request
 * partly on "it permanently consumes the ONE (user, controller, requestType) idempotency slot", which
 * is the PRE-ADR-013 idempotency semantics baked into a number. This line's key carries a cycle
 * dimension and a second lawful cycle is expected, so importing the price would have re-imported the
 * model it encodes — through a constant, where no reviewer would look for it. The expected-cost walk
 * that consumed those numbers goes with it; see ADR-036 for what replaces it and why less is right
 * here.
 */

/**
 * Controller classifications, mirrored from the Prisma `ControllerType` enum. Core stays free of
 * generated-client imports, so this is a string-identical copy; `packages/core/test/ladder.test.ts`
 * reads the schema and fails if the two drift.
 */
export const CONTROLLER_TYPES = [
  'CREDIT_BUREAU',
  'ADDRESS_TRADER',
  'DIRECTORY',
  'ECOMMERCE',
  'OTHER',
  'DATA_ENRICHMENT_BROKER',
  'HR_TECH',
  'AI_SCREENER',
  'SCREENING',
] as const;
export type ControllerType = (typeof CONTROLLER_TYPES)[number];

/**
 * Controller types for which a self-serve preference centre is NEVER an acceptable substitute for the
 * statutory instrument, whatever route directory happens to exist for them.
 *
 * These are the high-harm files: credit, employment and insurance decisions are made from them, and
 * what the consumer needs is the Art. 15(1) information and an evidence trail, not a toggle whose
 * effect nobody can later prove. It is also the anti-flattery guard on the ladder — a bureau that
 * publishes a slick "manage your data" page would otherwise let the router book a Tier-1 success and
 * close the case, which is exactly the outcome the leverage metric would reward and the user would
 * not notice.
 */
export const NEVER_SELF_SERVE_CONTROLLER_TYPES: readonly ControllerType[] = Object.freeze([
  'CREDIT_BUREAU',
  'AI_SCREENER',
  'SCREENING',
]);

/** The ladder's rungs. */
export const LEVERAGE_TIERS = ['0', '1', '2', '3', '4', '5', 'LEGAL'] as const;
export type LeverageTier = (typeof LEVERAGE_TIERS)[number];

/**
 * What the ledger's `tier` column can hold: a rung, or `NONE` for "we could not act". `NONE` is
 * deliberately NOT a `LeverageTier` — it is the absence of a rung, so it can never be ranked, never
 * appear in `OUTCOME_ACHIEVABLE_BY`, and never be compared against another tier by mistake.
 */
export type LedgerTier = LeverageTier | 'NONE';

/**
 * The explicit ladder contract: THE source of truth for "which rung comes first". Nothing may depend
 * on the declaration order of a type or an enum.
 *
 * The order is docs/08's own table, which is ordered by marginal cost per user: prevent, suppress,
 * make-yes-cheap, reputation, degrade, collective, and Legal last and "reserved". The pre-audit line
 * ranked LEGAL ahead of tiers 3–5 instead; this line follows its own normative doc. In practice the
 * difference is unexercised — nothing produces a tier-3/4/5 candidate yet — and the two structural
 * guards below (outcome equivalence and the high-harm bypass) are what actually keep artillery
 * reserved, rather than LEGAL's index in this map. Recorded in ADR-036 so the divergence is a decision
 * and not a drift.
 */
export const LADDER_ORDER: Readonly<Record<LeverageTier, number>> = Object.freeze({
  '0': 0, // Prevent — alias/maildrop at signup
  '1': 1, // Suppress — the company's own off-switch, suppression programmes
  '2': 2, // Cheap yes — correct routing, pre-verified identity packet
  '3': 3, // Reputation — Phase 2
  '4': 4, // Degrade — redirect real flow to owned channels
  '5': 5, // Collective — Phase 2
  LEGAL: 6, // the artillery: expensive, slow, reserved
});

/** Rank a rung. Throws rather than returning NaN — an unranked tier would sort arbitrarily. */
export function ladderRank(tier: LeverageTier): number {
  const rank = LADDER_ORDER[tier];
  if (rank === undefined) throw new Error(`tier "${String(tier)}" has no ladder rank`);
  return rank;
}

/**
 * What the user is actually trying to achieve, and which rungs may EVER claim to achieve it.
 *
 * The outcome is distinct from `requestType`: two instruments can serve one outcome, and — the case
 * that matters — one instrument can be the ONLY thing that serves an outcome. This is the equivalence axis, and the four
 * LEGAL-only entries are the whole reason it exists:
 *
 *  - ART15_INFORMATION_OBTAINED — a self-serve export returns a file; Art. 15(1) obliges purposes,
 *    recipients, retention and source. The router must never offer the button as a substitute, and
 *    because they are different outcomes here, it cannot.
 *  - DATA_SOURCE_DISCLOSED — nothing below LEGAL can produce it. No bureau publishes its suppliers and
 *    no export names them; Art. 15(1)(g) is the only instrument that reaches it, which is precisely
 *    why the Provenance module exists (docs/09).
 *  - BROKER_SOURCED_LAYER_ERASED — the Art. 17(1)(d) partial erasure at a bureau. A bureau's own
 *    "delete my account" route does not do this and could not: the demand is bounded by categories the
 *    bureau itself named in a prior Art. 15(1)(g) answer, and it deliberately leaves the contract data
 *    the user may still need. Letting a self-serve route claim it would trade a targeted, evidenced
 *    correction for an unbounded one the user did not ask for.
 *  - OBJECTION_LODGED — `OBJECTION_ART21` collapses Art. 21(1) (the enrichment-broker profiling case)
 *    and Art. 21(2) (the unconditional marketing objection) into one enum value. A 21(1) objection has
 *    no marketing self-serve equivalent, so routing it to a preference centre would fail the user's
 *    real outcome AND record it as handled. TODO(counsel): once the sub-right is distinguished
 *    (OBJECTION_ART21_1 vs _2), a genuine 21(2) objection MAY map to MARKETING_STOP.
 */
export const OUTCOME_ACHIEVABLE_BY = {
  ERASURE: ['0', '1', '2', 'LEGAL'],
  MARKETING_STOP: ['0', '1', '2', 'LEGAL'],
  DO_NOT_SELL: ['1', '2', 'LEGAL'],
  ACCOUNT_DELETION: ['1', '2', 'LEGAL'],
  CONSENT_WITHDRAWAL: ['1', '2', 'LEGAL'],
  ART15_INFORMATION_OBTAINED: ['LEGAL'],
  DATA_SOURCE_DISCLOSED: ['LEGAL'],
  BROKER_SOURCED_LAYER_ERASED: ['LEGAL'],
  OBJECTION_LODGED: ['LEGAL'],
} as const satisfies Readonly<Record<string, readonly LeverageTier[]>>;

/** The outcomes are the keys of the map above — there is no second list to drift out of step with it. */
export type ProtectionOutcome = keyof typeof OUTCOME_ACHIEVABLE_BY;
export const PROTECTION_OUTCOMES = Object.keys(OUTCOME_ACHIEVABLE_BY) as readonly ProtectionOutcome[];

/**
 * The tiers that may achieve an outcome, AT THE TYPE LEVEL. `TierFor<'DATA_SOURCE_DISCLOSED'>` is the
 * literal `'LEGAL'`, so a candidate builder that tries to offer a Tier-1 route for it does not compile
 * — the doctrine is checked before it is ever run.
 */
export type TierFor<O extends ProtectionOutcome> = (typeof OUTCOME_ACHIEVABLE_BY)[O][number];

/** Mechanisms the ledger can record. Each belongs to exactly one rung — see `MECHANISM_TIER`. */
export const LEVERAGE_MECHANISMS = [
  'SELF_SERVE_ROUTED',
  'REQUEST_CREATED',
  'NO_ROUTE_AVAILABLE',
] as const;
export type LeverageMechanism = (typeof LEVERAGE_MECHANISMS)[number];

/**
 * A mechanism may only ever be booked against its own rung. Without this a Tier-1 label can be put on
 * a legal send, and "outcomes per euro per tier" — the number docs/08 says steers the business — turns
 * into a number that flatters whichever rung the caller felt like crediting.
 */
export const MECHANISM_TIER: Readonly<Record<LeverageMechanism, LedgerTier>> = Object.freeze({
  SELF_SERVE_ROUTED: '1',
  REQUEST_CREATED: 'LEGAL',
  NO_ROUTE_AVAILABLE: 'NONE',
});

/**
 * Why a candidate rung was not taken. A closed union rather than free text: these are written to the
 * audit record, and the difference between "the bureau's self-serve route is not an acceptable
 * substitute" and "we did not think it was worth trying" is the difference between a defensible
 * decision and an unexplained one.
 */
export type RungRejectionReason =
  /** The route exists for this controller but serves a different outcome. */
  | 'WRONG_OUTCOME'
  /** No rung at this tier may EVER claim this outcome — the equivalence axis, not a preference. */
  | 'TIER_CANNOT_ACHIEVE_OUTCOME'
  /** A self-serve page is not an acceptable substitute for the statutory instrument here. */
  | 'HIGH_HARM_CONTROLLER_TYPE'
  /** This instrument is not available against this kind of controller at all (docs/07). */
  | 'INSTRUMENT_NOT_AVAILABLE_FOR_CONTROLLER'
  /** This user already took this rung for this controller and the outcome did not land. */
  | 'ALREADY_TRIED_BY_USER'
  | 'NO_PLAYBOOK'
  | 'ROUTE_INACTIVE';

export interface RungRejection {
  /** Route url / playbook-ish identifier — never personal data (this lands in an audit record). */
  readonly ref: string;
  readonly tier: LedgerTier;
  readonly reason: RungRejectionReason;
}

/** Ladder-order comparator. Lower rung first; ties are broken by the caller's own preference. */
export function byLadderOrder(a: LeverageTier, b: LeverageTier): number {
  return ladderRank(a) - ladderRank(b);
}

/** Is this tier permitted to claim this outcome at all? */
export function tierCanAchieve(tier: LeverageTier, outcome: ProtectionOutcome): boolean {
  return (OUTCOME_ACHIEVABLE_BY[outcome] as readonly LeverageTier[]).includes(tier);
}

/**
 * True when the statutory instrument is the only acceptable route for this controller, regardless of
 * what self-serve routes exist for it. `undefined` (an unclassified controller) is NOT treated as
 * high-harm: guessing would silently escalate every unknown controller to artillery, which is the
 * opposite of the doctrine. Classification is the census's job.
 */
export function requiresStatutoryInstrument(type: ControllerType | undefined): boolean {
  return type !== undefined && NEVER_SELF_SERVE_CONTROLLER_TYPES.includes(type);
}
