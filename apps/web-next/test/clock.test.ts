import { describe, expect, it } from 'vitest';
import { DE, EN, STRINGS } from '@scraper/i18n';
import { ClockContractError, clockCopy, remaining, resolveDeadline } from '../src/lib/clock';
import type { RequestView } from '../src/lib/types';

/**
 * Port-plan hazard 3, pinned.
 *
 * The pre-audit line's UI carried one `deadlineAt` and treated `AWAITING_RESPONSE` as proof that a
 * statutory clock was running. These tests are the reason that shape cannot be reintroduced here by
 * accident: the resolver refuses to produce a statutory deadline the API has not justified, and the
 * copy mapping is one function that the register tests already constrain.
 */
const base: RequestView = {
  id: 'req_1',
  controllerId: 'c_1',
  requestType: 'ACCESS_ART15_SOURCE',
  state: 'READY',
  statutoryDeadlineAt: null,
  provisionalDeadlineAt: null,
  clockIsProvable: false,
  outcome: null,
  nextAction: 'AWAIT_DISPATCH',
};

describe('resolveDeadline', () => {
  it('reports no deadline before any send', () => {
    expect(resolveDeadline(base)).toEqual({ kind: 'none' });
  });

  it('treats an email send as PROVISIONAL, never statutory', () => {
    const d = resolveDeadline({
      ...base,
      state: 'AWAITING_RESPONSE_PROVISIONAL',
      provisionalDeadlineAt: '2026-09-10T00:00:00.000Z',
    });
    expect(d.kind).toBe('provisional');
  });

  it('treats a provable send as STATUTORY', () => {
    const d = resolveDeadline({
      ...base,
      state: 'AWAITING_RESPONSE',
      statutoryDeadlineAt: '2026-09-10T00:00:00.000Z',
      provisionalDeadlineAt: '2026-09-01T00:00:00.000Z',
      clockIsProvable: true,
    });
    expect(d.kind).toBe('statutory');
    // The statutory clock wins when both are present — the provisional one was superseded by the
    // registered re-send that produced it.
    if (d.kind === 'statutory') expect(d.at.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('REFUSES a statutory deadline that no provable send justifies', () => {
    expect(() =>
      resolveDeadline({ ...base, statutoryDeadlineAt: '2026-09-10T00:00:00.000Z', clockIsProvable: false }),
    ).toThrow(ClockContractError);
  });

  it('never infers a clock from the state alone (the pre-audit line\'s defect)', () => {
    // AWAITING_RESPONSE with no dates is a contract oddity, not a licence to display a deadline.
    expect(resolveDeadline({ ...base, state: 'AWAITING_RESPONSE', clockIsProvable: true })).toEqual({ kind: 'none' });
  });
});

describe('clockCopy', () => {
  it('renders nothing when there is no deadline', () => {
    expect(clockCopy({ kind: 'none' }, DE)).toBeNull();
  });

  it('gives the provisional clock its own words and tone in every register', () => {
    for (const register of ['de', 'de-leicht', 'en'] as const) {
      const s = STRINGS[register];
      const provisional = clockCopy({ kind: 'provisional', at: new Date() }, s);
      const statutory = clockCopy({ kind: 'statutory', at: new Date() }, s);
      expect(provisional?.tone).toBe('provisional');
      expect(statutory?.tone).toBe('statutory');
      expect(provisional?.label).not.toBe(statutory?.label);
      expect(provisional?.note).not.toBe(statutory?.note);
    }
  });

  it('the provisional card never carries the statutory wording', () => {
    const provisional = clockCopy({ kind: 'provisional', at: new Date() }, DE);
    expect(provisional?.label).not.toMatch(/Gesetzliche Frist/i);
    expect(clockCopy({ kind: 'provisional', at: new Date() }, EN)?.label).not.toMatch(/statutory/i);
  });
});

describe('remaining', () => {
  it('counts down and floors at zero rather than going negative', () => {
    const now = new Date('2026-08-11T00:00:00.000Z');
    const soon = new Date('2026-08-13T05:30:00.000Z');
    expect(remaining(soon, now)).toEqual({ days: 2, hours: 5, minutes: 30, expired: false });
    const past = new Date('2026-08-01T00:00:00.000Z');
    expect(remaining(past, now)).toEqual({ days: 0, hours: 0, minutes: 0, expired: true });
  });
});
