import { describe, expect, it } from 'vitest';
import {
  allowedEvents,
  apply,
  countsTowardControllerStats,
  GuardViolationError,
  IllegalTransitionError,
  isTerminal,
  OUTCOMES,
  STATES,
  TRANSITIONS,
  WITHDRAW_EVENT,
  type RequestSnapshot,
  type RequestState,
} from '../src/index.js';

const AT = new Date('2026-08-07T10:00:00Z');

function req(over: Partial<RequestSnapshot> = {}): RequestSnapshot {
  return {
    id: 'req_1',
    state: 'DRAFT',
    userId: 'u1',
    controllerId: 'infoscore',
    requestType: 'ACCESS_ART15_SOURCE',
    provableSendConfirmedAt: null,
    deadlineAt: null,
    provisionalDeadlineAt: null,
    hasControllerResponse: false,
    reviewedByHuman: false,
    parseConfidence: null,
    humanReviewIfConfidenceBelow: 0.8,
    outcome: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------------------------
// Graph properties. These assert over the transition TABLE, so a future edit that adds an edge is
// caught even if nobody writes a test for that edge.
// ---------------------------------------------------------------------------------------------
describe('graph structure', () => {
  it('has no dead ends: every non-terminal state has an outbound edge', () => {
    for (const s of STATES) {
      if (isTerminal(s)) continue;
      const out = TRANSITIONS.filter((t) => t.from === s);
      expect(out.length, `${s} has no outbound transition but is not terminal`).toBeGreaterThan(0);
    }
  });

  it('has no unreachable states (other than the DRAFT entry point)', () => {
    for (const s of STATES) {
      if (s === 'DRAFT' || s === 'WITHDRAWN') continue; // WITHDRAWN is reached by the wildcard edge
      const inbound = TRANSITIONS.filter((t) => t.to === s);
      expect(inbound.length, `${s} is unreachable`).toBeGreaterThan(0);
    }
  });

  it('every terminal state has no outbound edge', () => {
    for (const s of STATES) {
      if (!isTerminal(s)) continue;
      expect(TRANSITIONS.filter((t) => t.from === s), `${s} is terminal but has outbound edges`).toHaveLength(0);
    }
  });

  it('references only declared states', () => {
    for (const t of TRANSITIONS) {
      expect(STATES).toContain(t.from);
      expect(STATES).toContain(t.to);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// GUARDRAIL: an auto-sent Art. 77 complaint must be UNREPRESENTABLE.
// ---------------------------------------------------------------------------------------------
describe('GUARDRAIL — an Art. 77 complaint can never be auto-sent', () => {
  it('ESCALATED has exactly one inbound edge', () => {
    const inbound = TRANSITIONS.filter((t) => t.to === 'ESCALATED');
    expect(
      inbound.map((t) => `${t.from}--${t.event}`),
      'adding a second way into ESCALATED breaks CLAUDE.md §5',
    ).toEqual(['ESCALATION_DRAFTED--humanSend']);
  });

  it('that edge requires a HUMAN_OPS actor', () => {
    expect(TRANSITIONS.find((t) => t.to === 'ESCALATED')!.requiredActor).toBe('HUMAN_OPS');
  });

  it('rejects humanSend attempted by SYSTEM', () => {
    expect(() => apply(req({ state: 'ESCALATION_DRAFTED' }), 'humanSend', { actor: 'SYSTEM', now: AT }))
      .toThrow(GuardViolationError);
  });

  it('rejects humanSend attempted by USER — self-service escalation is not a shortcut', () => {
    expect(() => apply(req({ state: 'ESCALATION_DRAFTED' }), 'humanSend', { actor: 'USER', now: AT }))
      .toThrow(GuardViolationError);
  });

  it('permits humanSend by HUMAN_OPS', () => {
    expect(apply(req({ state: 'ESCALATION_DRAFTED' }), 'humanSend', { actor: 'HUMAN_OPS', now: AT }).to)
      .toBe('ESCALATED');
  });

  it('no automatic (SYSTEM) event anywhere in the graph reaches ESCALATED', () => {
    const systemReachable = TRANSITIONS.filter((t) => t.to === 'ESCALATED' && t.requiredActor !== 'HUMAN_OPS');
    expect(systemReachable).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// GUARDRAIL: C1 — silence on a provisional clock can never escalate.
// ---------------------------------------------------------------------------------------------
describe('GUARDRAIL — the statutory clock only starts on a provable send', () => {
  it('deadlineExpired exists ONLY on AWAITING_RESPONSE', () => {
    const froms = TRANSITIONS.filter((t) => t.event === 'deadlineExpired').map((t) => t.from);
    expect(froms).toEqual(['AWAITING_RESPONSE']);
  });

  it('AWAITING_RESPONSE is only reachable via provableSendConfirmed', () => {
    const inbound = TRANSITIONS.filter((t) => t.to === 'AWAITING_RESPONSE');
    expect(inbound.map((t) => t.event)).toEqual(['provableSendConfirmed']);
  });

  it('silence on a PROVISIONAL clock cannot reach ESCALATION_DRAFTED (reachability, not mocking)', () => {
    // Ban the two edges that represent proven receipt: an actual reply, and a registered re-send.
    const banned = new Set(['responseIngested', 'userConfirmsResend:guardsPass']);
    const seen = new Set<RequestState>(['AWAITING_RESPONSE_PROVISIONAL']);
    const queue: RequestState[] = ['AWAITING_RESPONSE_PROVISIONAL'];
    while (queue.length) {
      const s = queue.shift()!;
      for (const t of TRANSITIONS.filter((t) => t.from === s && !banned.has(t.event))) {
        if (t.to === 'ESCALATION_DRAFTED') {
          throw new Error(`FORBIDDEN PATH: ${s} --${t.event}--> ESCALATION_DRAFTED on a provisional clock`);
        }
        if (!seen.has(t.to)) { seen.add(t.to); queue.push(t.to); }
      }
    }
    expect(seen.has('ESCALATION_DRAFTED')).toBe(false);
  });

  it('an email send sets provisionalDeadlineAt and explicitly NOT deadlineAt', () => {
    const r = apply(req({ state: 'SENT' }), 'sendAccepted:nonProvable', { actor: 'SYSTEM', now: AT, deadlineDays: 30 });
    expect(r.to).toBe('AWAITING_RESPONSE_PROVISIONAL');
    expect(r.patch.provisionalDeadlineAt).toEqual(new Date('2026-09-06T10:00:00Z'));
    expect(r.patch.deadlineAt).toBeNull();
  });

  it('provableSendConfirmed without QTSP-anchored proof is refused', () => {
    expect(() => apply(req({ state: 'SENT' }), 'provableSendConfirmed', { actor: 'SYSTEM', now: AT, deadlineDays: 30 }))
      .toThrow(/QTSP-anchored evidence/);
  });

  it('a provable send sets deadlineAt from the registered send time — one CALENDAR month, Berlin end of day', () => {
    const r = apply(req({ state: 'SENT' }), 'provableSendConfirmed', {
      actor: 'SYSTEM', now: AT, deadlineDays: 30, provableSendEvidenceId: 'ev_1',
    });
    expect(r.to).toBe('AWAITING_RESPONSE');
    // Sent 7 Aug 2026 → Art. 12(3) month ends with 7 Sep 2026 (a Monday), i.e. Berlin midnight
    // 8 Sep = 22:00 UTC in CEST. Not `+30 × 24h` (= 6 Sep 10:00Z), which expired a day early.
    expect(r.patch.deadlineAt).toEqual(new Date('2026-09-07T22:00:00Z'));
    expect(r.patch.provableSendConfirmedAt).toEqual(AT);
  });

  it('the registered re-send restarts a FRESH month rather than reusing the provisional date', () => {
    // provisional sent 1 Aug; user confirms re-send 7 Aug; the new clock runs from 7 Aug.
    const resent = apply(
      req({ state: 'SENT', provisionalDeadlineAt: new Date('2026-08-31T00:00:00Z') }),
      'provableSendConfirmed',
      { actor: 'SYSTEM', now: AT, deadlineDays: 30, provableSendEvidenceId: 'ev_2' },
    );
    expect(resent.patch.deadlineAt).toEqual(new Date('2026-09-07T22:00:00Z'));
  });

  it('declining the re-send closes as NO_PROVABLE_CLOCK, excluded from controller stats', () => {
    const r = apply(req({ state: 'AWAITING_REGISTERED_RESEND' }), 'userDeclinesResend', { actor: 'USER', now: AT });
    expect(r.to).toBe('CLOSED_FAILED');
    expect(r.patch.outcome).toBe('NO_PROVABLE_CLOCK');
    expect(countsTowardControllerStats('NO_PROVABLE_CLOCK')).toBe(false);
  });

  it('but a provable clock that runs out in silence DOES count', () => {
    expect(countsTowardControllerStats('NO_RESPONSE')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Outcome resolution — provable silence reaches the census (audit F2).
// ---------------------------------------------------------------------------------------------
describe('outcome — provable silence closes as NO_RESPONSE, not ABANDONED', () => {
  const silence = {
    provableSendConfirmedAt: new Date('2026-06-01T10:00:00Z'),
    deadlineAt: new Date('2026-07-01T22:00:00Z'), // expired well before AT
    hasControllerResponse: false,
  };

  it('discarding the silence-born draft still records what the CONTROLLER did', () => {
    const r = apply(req({ state: 'ESCALATION_DRAFTED', ...silence }), 'humanDiscard', { actor: 'HUMAN_OPS', now: AT });
    expect(r.to).toBe('CLOSED_FAILED');
    expect(r.patch.outcome).toBe('NO_RESPONSE');
  });

  it('an escalation that fails after provable silence records NO_RESPONSE too', () => {
    const r = apply(req({ state: 'ESCALATED', ...silence }), 'resolved:failed', { actor: 'HUMAN_OPS', now: AT });
    expect(r.patch.outcome).toBe('NO_RESPONSE');
  });

  it('a draft born of a refusal stays ABANDONED — the reply is on file, silence never happened', () => {
    const r = apply(
      req({ state: 'ESCALATION_DRAFTED', ...silence, hasControllerResponse: true }),
      'humanDiscard',
      { actor: 'HUMAN_OPS', now: AT },
    );
    expect(r.patch.outcome).toBe('ABANDONED');
  });

  it('a discard BEFORE the clock ran out stays ABANDONED', () => {
    const r = apply(
      req({ state: 'ESCALATION_DRAFTED', ...silence, deadlineAt: new Date('2026-12-01T22:00:00Z') }),
      'humanDiscard',
      { actor: 'HUMAN_OPS', now: AT },
    );
    expect(r.patch.outcome).toBe('ABANDONED');
  });

  it('a guard-failed creation stays ABANDONED (no clock ever ran)', () => {
    const r = apply(req({ state: 'DRAFT' }), 'guardFail(idempotency|mandate)', { actor: 'SYSTEM', now: AT });
    expect(r.to).toBe('CLOSED_FAILED');
    expect(r.patch.outcome).toBe('ABANDONED');
  });
});

// ---------------------------------------------------------------------------------------------
// Invariant 3b — escalation rests on proven receipt.
// ---------------------------------------------------------------------------------------------
describe('invariant 3b — humanResolve:escalate requires proven receipt', () => {
  it('is refused after a send failure with no response', () => {
    expect(() =>
      apply(req({ state: 'NEEDS_HUMAN', provableSendConfirmedAt: null, hasControllerResponse: false }),
        'humanResolve:escalate', { actor: 'HUMAN_OPS', now: AT }),
    ).toThrow(/neither a provable send nor a controller response/);
  });

  it('is allowed when the controller actually replied (their reply proves receipt)', () => {
    const r = apply(req({ state: 'NEEDS_HUMAN', hasControllerResponse: true }), 'humanResolve:escalate', {
      actor: 'HUMAN_OPS', now: AT,
    });
    expect(r.to).toBe('ESCALATION_DRAFTED');
  });

  it('is allowed after a provable send even with no reply', () => {
    const r = apply(req({ state: 'NEEDS_HUMAN', provableSendConfirmedAt: AT }), 'humanResolve:escalate', {
      actor: 'HUMAN_OPS', now: AT,
    });
    expect(r.to).toBe('ESCALATION_DRAFTED');
  });
});

// ---------------------------------------------------------------------------------------------
// Invariant 5 — the parser cannot decide alone.
// ---------------------------------------------------------------------------------------------
describe('invariant 5 — parser output cannot decide below the confidence floor', () => {
  for (const ev of ['validated:complied', 'validated:refused', 'validated:incomplete']) {
    it(`refuses ${ev} at low confidence with no human review`, () => {
      expect(() =>
        apply(req({ state: 'RESPONSE_RECEIVED', parseConfidence: 0.4, humanReviewIfConfidenceBelow: 0.8 }), ev, {
          actor: 'SYSTEM', now: AT,
        }),
      ).toThrow(GuardViolationError);
    });
  }

  it('allows it once a human has reviewed', () => {
    const r = apply(
      req({ state: 'RESPONSE_RECEIVED', parseConfidence: 0.4, humanReviewIfConfidenceBelow: 0.8, reviewedByHuman: true }),
      'validated:complied', { actor: 'HUMAN_OPS', now: AT },
    );
    expect(r.to).toBe('COMPLIED');
  });

  it('allows it above the floor', () => {
    const r = apply(req({ state: 'RESPONSE_RECEIVED', parseConfidence: 0.95 }), 'validated:complied', {
      actor: 'SYSTEM', now: AT,
    });
    expect(r.to).toBe('COMPLIED');
  });
});

// ---------------------------------------------------------------------------------------------
// C4/C5/H1 regressions.
// ---------------------------------------------------------------------------------------------
describe('audit regressions', () => {
  it('C4 — an incomplete answer is its own outcome, distinct from refusal', () => {
    expect(apply(req({ state: 'RESPONSE_RECEIVED', parseConfidence: 0.9 }), 'validated:incomplete', { actor: 'SYSTEM', now: AT }).to)
      .toBe('INCOMPLETE');
    expect(apply(req({ state: 'INCOMPLETE' }), 'escalate', { actor: 'SYSTEM', now: AT }).to)
      .toBe('ESCALATION_DRAFTED');
  });

  it('C4 — NEEDS_HUMAN can escalate directly without mislabelling as REFUSED', () => {
    expect(allowedEvents('NEEDS_HUMAN')).toContain('humanResolve:escalate');
  });

  it('C5 — BLOCKED_IDENTITY is not a dead end', () => {
    const out = allowedEvents('BLOCKED_IDENTITY').filter((e) => e !== WITHDRAW_EVENT);
    expect(out.length).toBeGreaterThan(0);
    expect(apply(req({ state: 'BLOCKED_IDENTITY' }), 'identityVerified:guardsPass', { actor: 'SYSTEM', now: AT }).to)
      .toBe('READY');
  });

  it('H1 — a late reply is ingestable after a complaint was drafted and after it was sent', () => {
    for (const s of ['ESCALATION_DRAFTED', 'ESCALATED', 'REFUSED', 'INCOMPLETE'] as const) {
      expect(apply(req({ state: s }), 'responseIngested', { actor: 'SYSTEM', now: AT }).to).toBe('RESPONSE_RECEIVED');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Exhaustive coverage: every (state, event) pair is either a declared edge or rejected.
// ---------------------------------------------------------------------------------------------
describe('exhaustive transition matrix', () => {
  const allEvents = [...new Set(TRANSITIONS.map((t) => t.event))];

  it('covers every declared transition at least once', () => {
    const exercised = new Set<string>();
    for (const t of TRANSITIONS) {
      const snapshot = req({
        state: t.from,
        // satisfy the guards so we are testing the edge, not the guard
        provableSendConfirmedAt: AT,
        hasControllerResponse: true,
        parseConfidence: 1,
      });
      const ctx = {
        actor: t.requiredActor ?? ('SYSTEM' as const),
        now: AT,
        deadlineDays: 30,
        provableSendEvidenceId: 'ev_1',
      };
      const r = apply(snapshot, t.event, ctx);
      expect(r.to).toBe(t.to);
      exercised.add(`${t.from}|${t.event}`);
    }
    expect(exercised.size).toBe(TRANSITIONS.length);
  });

  it('rejects every undeclared (state, event) pair', () => {
    let checked = 0;
    for (const s of STATES) {
      for (const e of allEvents) {
        if (TRANSITIONS.some((t) => t.from === s && t.event === e)) continue;
        expect(() => apply(req({ state: s }), e, { actor: 'HUMAN_OPS', now: AT }), `${s} --${e}--> should be illegal`)
          .toThrow(IllegalTransitionError);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('allows withdrawal from every non-terminal state and refuses it from terminal ones', () => {
    for (const s of STATES) {
      if (isTerminal(s)) {
        expect(() => apply(req({ state: s }), WITHDRAW_EVENT, { actor: 'USER', now: AT })).toThrow(IllegalTransitionError);
      } else {
        expect(apply(req({ state: s }), WITHDRAW_EVENT, { actor: 'USER', now: AT }).to).toBe('WITHDRAWN');
      }
    }
  });

  it('every outcome is classified for stats purposes', () => {
    for (const o of OUTCOMES) expect(typeof countsTowardControllerStats(o)).toBe('boolean');
  });
});
