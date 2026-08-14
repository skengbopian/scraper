import { describe, expect, it } from 'vitest';
import { statutoryDeadlineAt } from '../src/state-machine/statutory-clock.js';

/**
 * The Art. 12(3) calendar month (Reg. 1182/71 / EDPB Guidelines 01/2022 §54): same-numbered day
 * next month, clamped to month end, extended over Sat/Sun and bundesweite Feiertage, expiring at
 * Europe/Berlin end of day. Every expectation below is the UTC instant of that Berlin midnight.
 */
describe('statutoryDeadlineAt', () => {
  it('plain weekday: 7 Aug → end of Mon 7 Sep (Berlin midnight 8 Sep, CEST)', () => {
    expect(statutoryDeadlineAt(new Date('2026-08-07T10:00:00Z'))).toEqual(new Date('2026-09-07T22:00:00Z'));
  });

  it('weekend extension: 13 Aug → 13 Sep is a Sunday → end of Mon 14 Sep', () => {
    expect(statutoryDeadlineAt(new Date('2026-08-13T09:00:00Z'))).toEqual(new Date('2026-09-14T22:00:00Z'));
  });

  it('missing date clamps: 31 Jan → end of Sat 28 Feb → extended to Mon 2 Mar (CET)', () => {
    expect(statutoryDeadlineAt(new Date('2026-01-31T12:00:00Z'))).toEqual(new Date('2026-03-02T23:00:00Z'));
  });

  it('Easter-derived holidays extend: 3 Mar → 3 Apr 2026 is Karfreitag → Sa/So → Ostermontag → end of Tue 7 Apr', () => {
    expect(statutoryDeadlineAt(new Date('2026-03-03T09:00:00Z'))).toEqual(new Date('2026-04-07T22:00:00Z'));
  });

  it('fixed holiday + year rollover: 1 Dec → 1 Jan 2027 is Neujahr (Fri) → weekend → end of Mon 4 Jan (CET)', () => {
    expect(statutoryDeadlineAt(new Date('2026-12-01T12:00:00Z'))).toEqual(new Date('2027-01-04T23:00:00Z'));
  });

  it('the trigger day is a BERLIN day: 22:30 UTC on 31 Aug is already 1 Sep in Berlin', () => {
    // Berlin 1 Sep 00:30 → month ends with Thu 1 Oct → Berlin midnight 2 Oct (CEST).
    expect(statutoryDeadlineAt(new Date('2026-08-31T22:30:00Z'))).toEqual(new Date('2026-10-01T22:00:00Z'));
  });

  it('winter result carries the CET offset: 20 Oct → end of Fri 20 Nov (Berlin midnight 21 Nov, CET)', () => {
    expect(statutoryDeadlineAt(new Date('2026-10-20T08:00:00Z'))).toEqual(new Date('2026-11-20T23:00:00Z'));
  });

  it('never expires before the naive same-date instant (the conservative direction of the fix)', () => {
    for (const iso of ['2026-01-15T09:00:00Z', '2026-05-29T16:00:00Z', '2026-07-31T07:00:00Z', '2027-02-28T11:00:00Z']) {
      const from = new Date(iso);
      const naiveSameDate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, from.getUTCDate(), from.getUTCHours()));
      expect(statutoryDeadlineAt(from).getTime()).toBeGreaterThanOrEqual(naiveSameDate.getTime());
    }
  });

  it('always lands exactly on a Berlin midnight (22:00 or 23:00 UTC)', () => {
    for (let month = 0; month < 12; month++) {
      const at = statutoryDeadlineAt(new Date(Date.UTC(2026, month, 17, 9, 30)));
      expect([22, 23]).toContain(at.getUTCHours());
      expect(at.getUTCMinutes()).toBe(0);
    }
  });
});
