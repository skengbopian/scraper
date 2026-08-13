import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LOGIN_LOCKOUT_MINUTES,
  LOGIN_THROTTLE,
  MAX_FAILED_LOGINS,
  MAX_FAILED_MFA,
  MFA_THROTTLE,
  PasswordPolicyError,
  RECOVERY_CODE_COUNT,
  SESSION_IDLE_TIMEOUT_MINUTES,
  STEP_UP_TTL_MINUTES,
  assertPasswordAcceptable,
  evaluateSession,
  findMatchingHash,
  generateRecoveryCodes,
  hashRecoveryCode,
  isLockedOut,
  isStepUpFresh,
  lockoutRemainingSeconds,
  nextThrottleState,
  normaliseRecoveryCode,
  sessionExpiryFrom,
  shouldTouchLastSeen,
  type SessionState,
} from '../src/index.js';

/**
 * The auth POLICY (docs/06 C2, ADR-035) — no database, no clock, no framework.
 *
 * That is the whole reason the policy is a separate pure module: these are the rules that decide
 * whether a person may see their own credit file, and every one of them is a boundary. A rule tested
 * only through an HTTP suite is a rule tested at one point in the middle of its range.
 */

const NOW = new Date('2026-08-13T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    userId: 'u1',
    createdAt: ago(60),
    expiresAt: new Date(NOW.getTime() + 6 * 3_600_000),
    lastSeenAt: ago(1),
    revokedAt: null,
    mfaCompletedAt: ago(59),
    stepUpAt: null,
    userErasedAt: null,
    ...over,
  };
}

describe('evaluateSession', () => {
  it('admits a live, MFA-complete session — without step-up', () => {
    const v = evaluateSession(session(), NOW);
    expect(v).toEqual({ ok: true, userId: 'u1', stepUp: false });
  });

  it('reports each rejection distinctly, because each has a different next action', () => {
    expect(evaluateSession(null, NOW)).toEqual({ ok: false, reason: 'UNKNOWN' });
    expect(evaluateSession(session({ revokedAt: ago(1) }), NOW).ok === false && evaluateSession(session({ revokedAt: ago(1) }), NOW)).toMatchObject({ reason: 'REVOKED' });
    expect(evaluateSession(session({ expiresAt: ago(1) }), NOW)).toMatchObject({ reason: 'EXPIRED' });
    expect(evaluateSession(session({ mfaCompletedAt: null }), NOW)).toMatchObject({ reason: 'MFA_INCOMPLETE' });
    expect(evaluateSession(session({ userErasedAt: ago(1) }), NOW)).toMatchObject({ reason: 'USER_ERASED' });
  });

  it('puts USER_ERASED ahead of every other reason', () => {
    // A user who exercised their own Art. 17 right must not be told "your session expired". The
    // account is gone; any other answer is both wrong and a disclosure about a deleted account.
    const erasedAndExpired = session({ userErasedAt: ago(1), expiresAt: ago(1), revokedAt: ago(1) });
    expect(evaluateSession(erasedAndExpired, NOW)).toMatchObject({ reason: 'USER_ERASED' });
  });

  describe('the idle timeout — the rule an absolute TTL cannot express', () => {
    it('rejects at the boundary, while the absolute TTL is still hours away', () => {
      const idle = session({ lastSeenAt: ago(SESSION_IDLE_TIMEOUT_MINUTES + 1) });
      expect(idle.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
      expect(evaluateSession(idle, NOW)).toMatchObject({ reason: 'IDLE_TIMEOUT' });
    });

    it('admits a session used exactly at the limit — the boundary is inclusive', () => {
      expect(evaluateSession(session({ lastSeenAt: ago(SESSION_IDLE_TIMEOUT_MINUTES) }), NOW).ok).toBe(true);
    });

    it('ranks REVOKED above IDLE_TIMEOUT — a revoked session is not merely stale', () => {
      expect(evaluateSession(session({ revokedAt: ago(1), lastSeenAt: ago(90) }), NOW)).toMatchObject({ reason: 'REVOKED' });
    });
  });

  describe('step-up freshness', () => {
    it('is false without a step-up, true inside the window, false past it', () => {
      expect(isStepUpFresh({ stepUpAt: null }, NOW)).toBe(false);
      expect(isStepUpFresh({ stepUpAt: ago(STEP_UP_TTL_MINUTES - 1) }, NOW)).toBe(true);
      expect(isStepUpFresh({ stepUpAt: ago(STEP_UP_TTL_MINUTES) }, NOW)).toBe(true);
      expect(isStepUpFresh({ stepUpAt: ago(STEP_UP_TTL_MINUTES + 1) }, NOW)).toBe(false);
    });

    it('never infers step-up from a recent sign-in', () => {
      // Completing MFA seconds ago is not step-up. If it were, the gate would open itself on every
      // sign-in and the whole control would be decorative.
      const justSignedIn = session({ mfaCompletedAt: ago(0), stepUpAt: null });
      expect(evaluateSession(justSignedIn, NOW)).toMatchObject({ ok: true, stepUp: false });
    });

    it('surfaces a fresh step-up on the verdict', () => {
      expect(evaluateSession(session({ stepUpAt: ago(1) }), NOW)).toMatchObject({ ok: true, stepUp: true });
    });
  });

  it('sets a 12-hour absolute expiry', () => {
    expect(sessionExpiryFrom(NOW).getTime() - NOW.getTime()).toBe(12 * 3_600_000);
  });

  it('touches lastSeenAt at most once a minute, so a read is not always a write', () => {
    expect(shouldTouchLastSeen(ago(0), NOW)).toBe(false);
    expect(shouldTouchLastSeen(ago(2), NOW)).toBe(true);
  });
});

describe('throttling — two budgets, and the separation IS the control', () => {
  const failures = (n: number, at: Date) => ({ failedCount: n, lastFailedAt: at });

  it('locks the password budget only at the limit, and frees it when the window passes', () => {
    expect(isLockedOut(failures(MAX_FAILED_LOGINS - 1, ago(1)), LOGIN_THROTTLE, NOW)).toBe(false);
    expect(isLockedOut(failures(MAX_FAILED_LOGINS, ago(1)), LOGIN_THROTTLE, NOW)).toBe(true);
    expect(isLockedOut(failures(MAX_FAILED_LOGINS, ago(LOGIN_LOCKOUT_MINUTES + 1)), LOGIN_THROTTLE, NOW)).toBe(false);
  });

  it('gives the second factor a TIGHTER, independent budget', () => {
    // Reaching the MFA budget means the password is already known, so it should cost less to trip.
    expect(MAX_FAILED_MFA).toBeLessThan(MAX_FAILED_LOGINS);
    // The same counter state is locked under one policy and not the other — which is precisely what
    // keeps a stranger who knows only the email from locking the victim out of their authenticator.
    const state = failures(MAX_FAILED_MFA, ago(1));
    expect(isLockedOut(state, MFA_THROTTLE, NOW)).toBe(true);
    expect(isLockedOut(state, LOGIN_THROTTLE, NOW)).toBe(false);
  });

  it('reports honest remaining time', () => {
    expect(lockoutRemainingSeconds(failures(MAX_FAILED_LOGINS, ago(5)), LOGIN_THROTTLE, NOW)).toBe(10 * 60);
    expect(lockoutRemainingSeconds(failures(1, ago(5)), LOGIN_THROTTLE, NOW)).toBe(0);
  });

  it('forgets old failures rather than accumulating them forever', () => {
    // A throttle that never forgets eventually locks out only legitimate users.
    const stale = nextThrottleState(failures(7, ago(LOGIN_LOCKOUT_MINUTES + 1)), 'FAILURE', LOGIN_THROTTLE, NOW);
    expect(stale.failedCount).toBe(1);
    const recent = nextThrottleState(failures(7, ago(1)), 'FAILURE', LOGIN_THROTTLE, NOW);
    expect(recent.failedCount).toBe(8);
    expect(nextThrottleState(failures(7, ago(1)), 'SUCCESS', LOGIN_THROTTLE, NOW)).toEqual({ failedCount: 0, lastFailedAt: null });
  });
});

describe('password policy', () => {
  const code = (fn: () => void): string => {
    try {
      fn();
    } catch (e) {
      return e instanceof PasswordPolicyError ? e.code : 'NOT_A_POLICY_ERROR';
    }
    return 'ACCEPTED';
  };

  it('accepts a long passphrase and rejects the predictable shapes', () => {
    expect(code(() => assertPasswordAcceptable('korrekt-pferd-batterie', 'a@b.de'))).toBe('ACCEPTED');
    expect(code(() => assertPasswordAcceptable('kurz', 'a@b.de'))).toBe('TOO_SHORT');
    expect(code(() => assertPasswordAcceptable('x'.repeat(201), 'a@b.de'))).toBe('TOO_LONG');
    expect(code(() => assertPasswordAcceptable('aaaaaaaaaaaaaaa', 'a@b.de'))).toBe('REPEATED_CHARACTER');
    expect(code(() => assertPasswordAcceptable('mein-passwort-hier', 'a@b.de'))).toBe('COMMON_SEQUENCE');
    expect(code(() => assertPasswordAcceptable('martina-mustermann', 'martina@example.de'))).toBe('CONTAINS_EMAIL');
  });

  it('does not treat a two-character local part as an email substring', () => {
    // Otherwise "jo@x.de" would reject any password containing "jo" — including "johannisbeere".
    expect(code(() => assertPasswordAcceptable('johannisbeeren-sind-gut', 'jo@x.de'))).toBe('ACCEPTED');
  });

  it('caps length so a huge input cannot make the KDF a DoS vector', () => {
    expect(code(() => assertPasswordAcceptable('a'.repeat(1_000_000), 'a@b.de'))).toBe('TOO_LONG');
  });
});

describe('recovery codes', () => {
  it('issues ten distinct codes and stores only hashes', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const [i, c] of codes.entries()) {
      expect(hashes[i]).toBe(hashRecoveryCode(c));
      expect(hashes[i]).not.toContain(normaliseRecoveryCode(c));
    }
  });

  it('matches a code the way a human retypes it — any case, dashes optional', () => {
    const { codes, hashes } = generateRecoveryCodes(3);
    const typed = codes[1]!.toLowerCase().replace('-', ' ');
    expect(findMatchingHash(typed, hashes)).toBe(hashes[1]);
    expect(findMatchingHash('not-a-real-code', hashes)).toBeNull();
  });

  it('draws from a 32-symbol alphabet, so byte % length stays unbiased', () => {
    // 256 divides evenly by 32. Change the alphabet length and the mapping silently favours the
    // first symbols — which is why the entropy note in the module is pinned to this number.
    const counts = new Map<string, number>();
    for (const c of generateRecoveryCodes(200).codes.join('').replace(/-/g, '')) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThan(25); // all 32 symbols reachable in practice
  });

  it('uses an alphabet without the characters people misread off paper', () => {
    // I/L/O/U are absent: a recovery code is transcribed by hand, in a hurry, by someone locked out.
    for (const c of generateRecoveryCodes(20).codes.join('')) {
      expect('ILOU').not.toContain(c);
    }
  });
});

describe('the policy module stays pure', () => {
  it('session.ts imports nothing at all', () => {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const src = fs.readFileSync(path.join(ROOT, 'src/auth/session.ts'), 'utf8');
    // Not style policing: the moment this file imports a domain type or an I/O helper, the rules that
    // decide who may see a credit file stop being testable without standing the system up.
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
