/**
 * Session, step-up and throttling POLICY (docs/06 C2) — port wave 3, ADR-035.
 *
 * Pure decisions only. There are no imports in this file, and that is a constraint rather than an
 * accident: the rules that decide "is this person still allowed to see a credit file" are the ones
 * most worth being able to test with no database, no clock and no framework. Token generation and
 * hashing live in `apps/api/src/auth/crypto.ts`; persistence is the Prisma layer's problem.
 *
 * `now` is injected everywhere for the same reason — a policy that reads the wall clock cannot be
 * tested at a boundary, and every rule here IS a boundary.
 */

export const SESSION_TTL_HOURS = 12;

/**
 * A session dies from inactivity, not just from age.
 *
 * Scraper holds a user's credit file and their cross-broker map (docs/06 C2). A tab left open on a
 * shared laptop must not still be authenticated hours later, and absolute TTL alone cannot express
 * that — 12h of idle is exactly the window that matters.
 */
export const SESSION_IDLE_TIMEOUT_MINUTES = 30;

/**
 * How long a fresh second-factor challenge keeps step-up open.
 *
 * Short on purpose. Step-up gates the credit file and the assembled data map — the surfaces where a
 * single compromised session does the most damage. Ten minutes is enough to read what you came for
 * and not much else.
 */
export const STEP_UP_TTL_MINUTES = 10;

/** Why a session may not act. Each value maps to exactly one thing the caller must do next. */
export type SessionRejection =
  | 'UNKNOWN'
  | 'REVOKED'
  | 'EXPIRED'
  | 'IDLE_TIMEOUT'
  | 'MFA_INCOMPLETE'
  | 'USER_ERASED';

export interface SessionState {
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  readonly revokedAt: Date | null;
  /**
   * NULL until the second factor is presented. A session in this state is authenticated for NOTHING
   * except completing the challenge.
   */
  readonly mfaCompletedAt: Date | null;
  readonly stepUpAt: Date | null;
  readonly userErasedAt: Date | null;
}

export type SessionVerdict =
  | { readonly ok: true; readonly userId: string; readonly stepUp: boolean }
  | { readonly ok: false; readonly reason: SessionRejection };

/**
 * Decide whether a session may act.
 *
 * The order is load-bearing. `USER_ERASED` is checked before everything else because a user who has
 * exercised their own Art. 17 right must not be told "your session expired" — the account is gone,
 * and any other answer is both wrong and a disclosure. `MFA_INCOMPLETE` is deliberately its own
 * verdict rather than a rejection: the half-authenticated session must be able to reach exactly one
 * endpoint (submit the code) and nothing else, and collapsing it into UNKNOWN would make a correct
 * MFA flow impossible to build.
 */
export function evaluateSession(state: SessionState | null, now: Date): SessionVerdict {
  if (!state) return { ok: false, reason: 'UNKNOWN' };
  if (state.userErasedAt) return { ok: false, reason: 'USER_ERASED' };
  if (state.revokedAt) return { ok: false, reason: 'REVOKED' };
  if (state.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'EXPIRED' };
  if (now.getTime() - state.lastSeenAt.getTime() > SESSION_IDLE_TIMEOUT_MINUTES * 60_000) {
    return { ok: false, reason: 'IDLE_TIMEOUT' };
  }
  if (!state.mfaCompletedAt) return { ok: false, reason: 'MFA_INCOMPLETE' };
  return { ok: true, userId: state.userId, stepUp: isStepUpFresh(state, now) };
}

/**
 * Is step-up still fresh?
 *
 * Note what this does NOT do: it never grants step-up on the strength of a recent login. Completing
 * MFA at sign-in and confirming it again to open the credit file are different acts, and treating
 * the first as the second would make the whole gate ornamental.
 */
export function isStepUpFresh(state: Pick<SessionState, 'stepUpAt'>, now: Date): boolean {
  if (!state.stepUpAt) return false;
  return now.getTime() - state.stepUpAt.getTime() <= STEP_UP_TTL_MINUTES * 60_000;
}

export function sessionExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + SESSION_TTL_HOURS * 3_600_000);
}

/**
 * Should this request write `lastSeenAt`?
 *
 * The idle timeout needs a per-request timestamp, but writing one on every request turns every read
 * into a write. A session is only touched once its recorded activity is stale by more than this, so
 * a busy tab costs one UPDATE a minute rather than one per asset.
 */
export const SESSION_TOUCH_INTERVAL_SECONDS = 60;

export function shouldTouchLastSeen(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_SECONDS * 1000;
}

// ---------------------------------------------------------------------------------------------
// Throttling. TWO independent budgets — see the note on the MFA constants.
// ---------------------------------------------------------------------------------------------

/**
 * Failed passwords before an account stops accepting them for a while.
 *
 * Locks the ACCOUNT, not the IP: an attacker spraying one password across many accounts from a
 * rotating pool defeats IP limits entirely, and the account is the axis that protects the specific
 * person being targeted.
 */
export const MAX_FAILED_LOGINS = 8;
export const LOGIN_LOCKOUT_MINUTES = 15;

/**
 * The second-factor budget is SEPARATE, and the separation is the point.
 *
 * A password lockout is triggerable by anyone who knows the email address — that is acceptable for
 * passwords, because the alternative (no lockout) is worse. It is NOT acceptable for the second
 * factor: if both counters were one budget, a stranger with only the victim's email could spray
 * passwords until the account stopped accepting the victim's own authenticator codes, locking them
 * out of the account that holds their credit file. Keeping the budgets apart means the MFA counter
 * can only be moved by someone who already passed the password step, i.e. by the account holder or
 * by an attacker who already has the password — at which point throttling the second factor is
 * exactly what should happen.
 *
 * The MFA budget is also tighter: reaching it means the password is already known.
 */
export const MAX_FAILED_MFA = 5;
export const MFA_LOCKOUT_MINUTES = 15;

export interface ThrottleState {
  readonly failedCount: number;
  readonly lastFailedAt: Date | null;
}

export interface ThrottlePolicy {
  readonly maxFailed: number;
  readonly lockoutMinutes: number;
}

export const LOGIN_THROTTLE: ThrottlePolicy = Object.freeze({
  maxFailed: MAX_FAILED_LOGINS,
  lockoutMinutes: LOGIN_LOCKOUT_MINUTES,
});
export const MFA_THROTTLE: ThrottlePolicy = Object.freeze({
  maxFailed: MAX_FAILED_MFA,
  lockoutMinutes: MFA_LOCKOUT_MINUTES,
});

export function isLockedOut(state: ThrottleState, policy: ThrottlePolicy, now: Date): boolean {
  if (state.failedCount < policy.maxFailed || !state.lastFailedAt) return false;
  return now.getTime() - state.lastFailedAt.getTime() < policy.lockoutMinutes * 60_000;
}

/** Seconds until a locked-out budget frees up; 0 when it is not locked. For an honest error message. */
export function lockoutRemainingSeconds(state: ThrottleState, policy: ThrottlePolicy, now: Date): number {
  if (!isLockedOut(state, policy, now)) return 0;
  const elapsed = now.getTime() - state.lastFailedAt!.getTime();
  return Math.max(0, Math.ceil((policy.lockoutMinutes * 60_000 - elapsed) / 1000));
}

/**
 * The next counter state.
 *
 * Counters reset once the window passes, so a user who mistypes today is not one attempt away from a
 * lockout next week — a throttle that never forgets eventually locks out only legitimate users.
 */
export function nextThrottleState(
  state: ThrottleState,
  outcome: 'SUCCESS' | 'FAILURE',
  policy: ThrottlePolicy,
  now: Date,
): ThrottleState {
  if (outcome === 'SUCCESS') return { failedCount: 0, lastFailedAt: null };
  const windowExpired =
    state.lastFailedAt !== null &&
    now.getTime() - state.lastFailedAt.getTime() >= policy.lockoutMinutes * 60_000;
  return { failedCount: windowExpired ? 1 : state.failedCount + 1, lastFailedAt: now };
}

// ---------------------------------------------------------------------------------------------
// Password policy.
// ---------------------------------------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export class PasswordPolicyError extends Error {
  constructor(
    message: string,
    /** Stable code so the API can translate without parsing prose (packages/i18n). */
    public readonly code: 'TOO_SHORT' | 'TOO_LONG' | 'CONTAINS_EMAIL' | 'REPEATED_CHARACTER' | 'COMMON_SEQUENCE',
  ) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

/**
 * Length over composition rules.
 *
 * Character-class requirements push people to "Passwort1!" and are worse than useless; length plus a
 * check against the obvious candidates is the guidance that survives contact with users. The maximum
 * exists so a megabyte "password" cannot turn the hash function into a DoS vector.
 */
export function assertPasswordAcceptable(password: string, email: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'TOO_SHORT');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`password must be at most ${MAX_PASSWORD_LENGTH} characters`, 'TOO_LONG');
  }
  const lowered = password.toLowerCase();
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 3 && lowered.includes(localPart)) {
    throw new PasswordPolicyError('password must not contain your email address', 'CONTAINS_EMAIL');
  }
  if (/^(.)\1+$/.test(password)) {
    throw new PasswordPolicyError('password must not be a single repeated character', 'REPEATED_CHARACTER');
  }
  for (const common of ['password', 'passwort', 'qwertz', 'qwerty', '12345678', 'letmein', 'geheim']) {
    if (lowered.includes(common)) {
      throw new PasswordPolicyError('password contains a very common sequence', 'COMMON_SEQUENCE');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Recovery codes.
// ---------------------------------------------------------------------------------------------

/**
 * Losing a phone must not mean losing access to your own data-rights account — which is precisely
 * the account holding evidence you may need, and which nobody can restore for you: the TOTP secret
 * is envelope-encrypted under the user's own key (CLAUDE.md §4), so there is no support path that
 * recovers it. Ten single-use codes, shown once, stored hashed.
 */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Characters per code, NOT bytes of entropy — each character carries 5 bits (a 32-symbol alphabet).
 *
 * 16 characters = 80 bits, and the number is set by the offline threat, not the online one. The codes
 * are stored as unsalted SHA-256 so they can be looked up by hash; that means a single brute-force
 * sweep tests every candidate against EVERY user's row at once. At 50 bits (the obvious 10-character
 * choice) such a sweep is hours of GPU time and breaks the whole user base; at 80 bits it is not
 * reachable. Transcription cost is four extra groups on a page printed once.
 */
export const RECOVERY_CODE_LENGTH = 16;
