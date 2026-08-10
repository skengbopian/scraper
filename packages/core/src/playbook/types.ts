import type { SubjectField } from '../identity/subject.js';

/** Mirrors `schema/playbook.schema.json`. The schema is normative; this is the TypeScript view of it. */

export type Channel = 'email' | 'web_form' | 'postal';
export type ActionType =
  | 'OBJECTION_ART21'
  | 'ACCESS_ART15'
  | 'ACCESS_ART15_SOURCE'
  | 'ERASURE_ART17'
  | 'EINMELDUNG_FRAUD'
  | 'ROBINSON';
export type EscalationAction = 'DRAFT_ART77' | 'NONE';
export type IdentityProofKind = 'redacted_id' | 'full_id' | 'none';

export interface Matcher {
  readonly responseContains?: readonly string[];
  readonly [structuredKey: string]: unknown;
}

export interface Condition {
  readonly anyOf?: readonly Matcher[];
  readonly allOf?: readonly Matcher[];
  readonly responseContains?: readonly string[];
}

export interface Playbook {
  readonly slug: string;
  readonly kind: 'RIGHTS_REQUEST' | 'ENROLMENT';
  readonly controller: string;
  readonly requestType: ActionType;
  readonly version: number;
  readonly active: boolean;
  readonly parameterised?: boolean;
  readonly legalBasis?: string;
  readonly channel: {
    readonly primary: Channel;
    readonly fallback?: Channel;
    readonly registered?: { readonly primary?: boolean; readonly fallback?: boolean };
  };
  readonly recipient: { readonly email?: string; readonly postal?: string; readonly webForm?: string };
  readonly template: string;
  readonly templateFlags?: Readonly<Record<string, boolean>>;
  readonly seatDpa?: string;
  readonly enrolment?: {
    readonly programSlug: string;
    readonly renewalMonths?: number;
    readonly producesEntity: 'SUPPRESSION_ENROLMENT' | 'FRAUD_MARKER_FILING';
  };
  readonly provenance?: {
    readonly extractPerCategory: boolean;
    readonly brokerWatchlist?: readonly string[];
    readonly expectSource?: string;
    readonly flagIf?: { readonly incompleteSourceList?: boolean; readonly contradictsArt14?: boolean };
  };
  readonly identityProof?: { readonly required: boolean; readonly accepts: readonly IdentityProofKind[] };
  readonly subjectFields: readonly SubjectField[];
  readonly deadlineDays?: number;
  readonly validation: {
    readonly compliedIf: Condition;
    readonly refusedIf?: Condition;
    readonly incompleteIf?: Condition;
    readonly humanReviewIfConfidenceBelow: number;
  };
  readonly escalation?: {
    readonly onDeadlineExpiry: EscalationAction;
    readonly onRefusal: EscalationAction;
    readonly onIncompleteSourceList?: EscalationAction;
  };
  readonly notes?: string;
}

/**
 * Flags the engine derives at render time. A playbook may NOT declare these — a statically declared
 * `identityProofEnclosed` would let a letter assert an enclosure that was never attached (audit C6).
 */
export const ENGINE_DERIVED_FLAGS = ['identityProofEnclosed'] as const;
export type EngineDerivedFlag = (typeof ENGINE_DERIVED_FLAGS)[number];
