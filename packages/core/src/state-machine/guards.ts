import { deriveSubject, type RequestSubject, type VerifiedIdentity } from '../identity/subject.js';

/**
 * The guard set that runs on EVERY entry to READY — from DRAFT, from BLOCKED_IDENTITY on
 * identityVerified, from NEEDS_HUMAN on resend, and from AWAITING_REGISTERED_RESEND on user confirm.
 *
 * "Every entry" is invariant 1 and is not decorative: the resend paths re-enter READY without passing
 * through DRAFT, so a guard that only ran at creation would let a request whose mandate was revoked
 * mid-flight go back out.
 */

export type RequestTypeStatutory =
  | 'OBJECTION_ART21'
  | 'ACCESS_ART15'
  | 'ACCESS_ART15_SOURCE'
  | 'ERASURE_ART17';

export interface MandateSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly scope: readonly RequestTypeStatutory[];
  readonly signedAt: Date;
  readonly revokedAt: Date | null;
}

export interface OpenRequestRef {
  readonly id: string;
  readonly userId: string;
  readonly controllerId: string;
  readonly requestType: string;
}

export interface GuardInput {
  readonly requestId: string;
  readonly userId: string;
  readonly controllerId: string;
  readonly requestType: RequestTypeStatutory;
  readonly identity: VerifiedIdentity;
  readonly mandates: readonly MandateSnapshot[];
  /** Every non-terminal request for this (user, controller, requestType) — INCLUDING this one. */
  readonly nonTerminalSiblings: readonly OpenRequestRef[];
  readonly now: Date;
}

export type GuardOutcome =
  | { readonly ok: true; readonly subject: RequestSubject }
  | { readonly ok: false; readonly failed: 'identity'; readonly reason: string }
  | { readonly ok: false; readonly failed: 'mandate' | 'idempotency'; readonly reason: string };

/**
 * A guard failure routes to a different state depending on which guard failed:
 *   identity  -> BLOCKED_IDENTITY (recoverable — the user can go and verify)
 *   otherwise -> CLOSED_FAILED
 */
export function runGuards(input: GuardInput): GuardOutcome {
  // --- 1. Identity. The anti-stalker keystone. -------------------------------------------------
  if (input.identity.userId !== input.userId) {
    return {
      ok: false,
      failed: 'identity',
      reason: `identity ${input.identity.id} belongs to user ${input.identity.userId}, not ${input.userId}`,
    };
  }
  let subject: RequestSubject;
  try {
    subject = deriveSubject(input.identity);
  } catch (e) {
    return { ok: false, failed: 'identity', reason: (e as Error).message };
  }

  // --- 2. Mandate. Adversarial actions need a live, in-scope authorisation (docs/05 §2). --------
  const live = input.mandates.filter((m) => m.userId === input.userId && m.revokedAt === null);
  if (!live.some((m) => m.scope.includes(input.requestType))) {
    return {
      ok: false,
      failed: 'mandate',
      reason: `no live Mandate covers ${input.requestType} for user ${input.userId}`,
    };
  }

  // --- 3. Idempotency (audit C3). --------------------------------------------------------------
  // SELF-EXCLUSION IS LOAD-BEARING. The resend paths re-enter READY while this very request is still
  // non-terminal; without the filter it would block on itself and the flagship's chase path would
  // dead-end. See ARCHITECTURE-DECISIONS ADR-013.
  const others = input.nonTerminalSiblings.filter(
    (r) =>
      r.id !== input.requestId &&
      r.userId === input.userId &&
      r.controllerId === input.controllerId &&
      r.requestType === input.requestType,
  );
  if (others.length > 0) {
    return {
      ok: false,
      failed: 'idempotency',
      reason:
        `another non-terminal request (${others.map((o) => o.id).join(', ')}) already exists for ` +
        `(${input.userId}, ${input.controllerId}, ${input.requestType}). ` +
        `This blocks accidental duplicates only — a new cycle after the previous one closes is allowed.`,
    };
  }

  return { ok: true, subject };
}

/** `cycleOrdinal = 1 + count(terminal predecessors for that triple)` (docs/03). */
export function nextCycleOrdinal(terminalPredecessorCount: number): number {
  return 1 + terminalPredecessorCount;
}

/**
 * Art. 12(5) "excessive": a fresh cycle too soon after the last one closed needs an explicit reason.
 * `minReExerciseDays` is a TODO(counsel) (ARCHITECTURE-DECISIONS OQ-9) — the caller supplies it so
 * the number lives in config, not in code.
 */
export function mayOpenNewCycle(args: {
  readonly previousClosedAt: Date | null;
  readonly minReExerciseDays: number;
  readonly cause: 'USER_INITIATED' | 'PROVENANCE_CHAIN' | 'FRAUD_REPAIR';
  readonly userExplicitlyReExercised: boolean;
  readonly now: Date;
}): { ok: true } | { ok: false; reason: string } {
  if (args.previousClosedAt === null) return { ok: true };
  // A provenance-driven follow-up is a distinct cause, not a repeat of the same ask.
  if (args.cause !== 'USER_INITIATED') return { ok: true };
  if (args.userExplicitlyReExercised) return { ok: true };
  const elapsedDays = (args.now.getTime() - args.previousClosedAt.getTime()) / 86_400_000;
  if (elapsedDays >= args.minReExerciseDays) return { ok: true };
  return {
    ok: false,
    reason:
      `only ${Math.floor(elapsedDays)} days since the previous cycle closed (minimum ${args.minReExerciseDays}). ` +
      `Repeating an access request too soon risks being deemed excessive under Art. 12(5). ` +
      `Ask the user to confirm they intend to re-exercise.`,
  };
}
