/**
 * Wire-shape mirrors of this API's responses (dates arrive as ISO strings over JSON).
 *
 * Sources of truth:
 *   apps/api/src/requests/requests.service.ts  (the request view + nextAction map)
 *   apps/api/src/census/census.controller.ts   (the census view)
 *   packages/core/src/state-machine/states.ts  (the state union)
 *
 * NOTE what is NOT here: a single `deadlineAt`. The pre-audit line had one, and porting it is the
 * defect this file exists to avoid — see `clock.ts`.
 */

/** All 16 states (packages/core/src/state-machine/states.ts). The pre-audit line had 13. */
export const REQUEST_STATES = [
  'DRAFT',
  'BLOCKED_IDENTITY',
  'READY',
  'SENT',
  'AWAITING_DELIVERY_PROOF',
  'AWAITING_RESPONSE_PROVISIONAL',
  'AWAITING_REGISTERED_RESEND',
  'AWAITING_RESPONSE',
  'RESPONSE_RECEIVED',
  'NEEDS_HUMAN',
  'COMPLIED',
  'INCOMPLETE',
  'REFUSED',
  'ESCALATION_DRAFTED',
  'ESCALATED',
  'CLOSED_FAILED',
  'WITHDRAWN',
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const REQUEST_TYPES = ['OBJECTION_ART21', 'ACCESS_ART15', 'ACCESS_ART15_SOURCE', 'ERASURE_ART17'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

/** The three real engine outcomes (planRequestCreation, ADR-025). */
export type EngineOutcome = 'SELF_SERVE' | 'LEGAL' | 'NONE';

export interface RequestView {
  readonly id: string;
  readonly controllerId: string;
  readonly requestType: RequestType;
  readonly state: RequestState;
  /** The Art. 12(3) clock. Non-null ONLY after a provable send. */
  readonly statutoryDeadlineAt: string | null;
  /** An internal scheduling hint from a non-provable send. Never a legal deadline. */
  readonly provisionalDeadlineAt: string | null;
  readonly clockIsProvable: boolean;
  readonly outcome: string | null;
  readonly nextAction: string;
}

export interface SelfServeView {
  readonly url: string;
  readonly steps: readonly string[];
  readonly requiresLogin: boolean;
}

export interface CommunityRecord {
  readonly email: string | null;
  readonly fax: string | null;
  readonly quality: string | null;
  readonly sources: readonly string[];
}

export interface CensusController {
  readonly slug: string;
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly risk: 'crit' | 'warn' | 'mut';
  readonly riskLbl: string;
  readonly holds: string;
  readonly defaultRequestType: RequestType;
  readonly featured: boolean;
  /** A UI hint only — the authoritative decision is always POST /requests. */
  readonly expectedOutcome: EngineOutcome;
  readonly selfServe: SelfServeView | null;
  readonly community: CommunityRecord | null;
}

export type CreateRequestResult =
  | { readonly routed: 'SELF_SERVE'; readonly nextAction: string; readonly route: SelfServeView; readonly reason: string }
  | { readonly routed: 'NONE'; readonly nextAction: string; readonly reason: string }
  | { readonly routed: 'LEGAL'; readonly id: string; readonly state: 'READY'; readonly nextAction: string };

/** BYO-Datenkopie findings (docs/10 §3.1). */
export type FindingSeverity = 'INFO' | 'UPCOMING' | 'OVERDUE';
export type FindingAction = 'REQUEST_DELETION' | 'DISPUTE_ART16' | 'REVIEW' | 'NONE';

export interface FileFinding {
  readonly entryId: string | null;
  readonly ruleId: string;
  readonly ruleSetVersion: string;
  readonly severity: FindingSeverity;
  readonly computedDeadlineAt: string | null;
  readonly recommendedAction: FindingAction;
  readonly scoreRelevance: string | null;
  /** CoC rights that are privacy-positive but score-NEGATIVE must warn before acting (docs/10 §2.1). */
  readonly scoreNegativeWarning: boolean;
  readonly explanation: string;
  readonly entryLabel?: string | null;
}

export interface CreditFileView {
  readonly snapshotId: string | null;
  readonly controllerId?: string;
  readonly parseConfidence?: number;
  readonly ruleSet: { readonly version: string; readonly counselSignedOff: boolean; readonly preliminary: boolean };
  readonly findings: readonly FileFinding[];
  readonly nextAction?: string;
}

// ------------------------------------------------------------------------------------------------
// The internal review queue (port wave 5, ADR-037)
// ------------------------------------------------------------------------------------------------

/**
 * One case waiting on a person.
 *
 * Note what is NOT here, and that the absence is the design: no legal name, no date of birth, no
 * address. A cross-user ledger keyed to real identities is exactly the artefact CLAUDE.md's one rule
 * describes — a map of who is exercising rights against whom. `userId` is opaque: enough to
 * correlate two tickets, not enough to locate anyone. The API does not send more than this, and this
 * type is why a future field would have to be added deliberately.
 */
export interface OpsQueueItem {
  readonly id: string;
  readonly userId: string;
  readonly controllerSlug: string;
  readonly requestType: RequestType;
  readonly state: RequestState;
  /** Whether the Art. 12(3) clock is genuinely running. NOT a date — see the note in ops/page.tsx. */
  readonly clockIsProvable: boolean;
  /** Presence only (which clock, if any, runs) — rendering a date stays DeadlineCard's job. */
  readonly statutoryDeadlineAt: string | null;
  readonly provisionalDeadlineAt: string | null;
  readonly reason: string | null;
  readonly queuedAt: string;
  /**
   * Where an Art. 77 complaint for this case gets filed (decision D4). `USER_RESIDENCE` arrives with
   * no authority resolved on purpose — it depends on the data subject's Land, which this payload
   * deliberately does not carry.
   */
  readonly escalationVenue:
    | { readonly kind: 'SEAT'; readonly dpa: string }
    | { readonly kind: 'USER_RESIDENCE'; readonly dpa: null }
    | null;
}

/**
 * One row of the abuse-review log (CLAUDE.md's one rule; audit M3).
 *
 * SUBJECT_MISMATCH — someone uploading a Datenkopie about a DIFFERENT person than the verified
 * account holder — is the highest-signal abuse event this product can observe, and it is exactly the
 * shape a stalker's first attempt takes. The table has been written since migration 0013 and the API
 * has listed it since; nothing rendered it, so "flag anomalous targeting for human review" was a row
 * in a database nobody opened.
 *
 * `userId` is the opaque id and `detail` is a bounded string the API caps. Deliberately no subject
 * identifiers: an abuse log that named people would itself be the artefact the rule exists to
 * prevent.
 */
export interface AnomalyEventView {
  readonly id: string;
  readonly userId: string | null;
  readonly kind: string;
  readonly detail: string;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
}

/** A document that arrived without knowing which case it answers. Correlated by a human. */
export interface InboundDocumentView {
  readonly id: string;
  readonly receivedAt: string;
  readonly channel: string;
  /** As received, and rendered as received. Untrusted: a sender can write anything here. */
  readonly senderRef: string;
  readonly subjectLine: string | null;
  readonly assignedRequestId: string | null;
}
