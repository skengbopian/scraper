import { describe, expect, it } from 'vitest';
import {
  addMonthsUTC,
  APPLICANT_RETENTION_MONTHS,
  APPLICANT_RETENTION_RULESET_VERSION,
  assessApplicantRetention,
  floorToUtcDay,
  type ApplicantRecord,
} from '../src/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function rec(over: Partial<ApplicantRecord> = {}): ApplicantRecord {
  return { controllerSlug: 'acme-gmbh', rejectedAt: new Date('2026-01-10T00:00:00Z'), aggClaimPending: false, talentPoolConsent: false, ...over };
}

describe('addMonthsUTC', () => {
  it('adds calendar months', () => {
    expect(addMonthsUTC(new Date('2026-01-10T00:00:00Z'), 6).toISOString()).toBe('2026-07-10T00:00:00.000Z');
  });
  it('clamps a month-end date to the last day of the target month', () => {
    // Aug 31 + 6mo → Feb (28 in 2027), never rolls into March.
    expect(addMonthsUTC(new Date('2026-08-31T00:00:00Z'), 6).toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });
  it('crosses a year boundary', () => {
    expect(addMonthsUTC(new Date('2026-10-01T00:00:00Z'), 6).toISOString()).toBe('2027-04-01T00:00:00.000Z');
  });
});

describe('assessApplicantRetention (docs/10 §7.7 target #2)', () => {
  it('flags deletion overdue once the ~6-month window has elapsed', () => {
    const f = assessApplicantRetention(rec({ rejectedAt: new Date('2026-01-01T00:00:00Z') }), new Date('2026-08-10T00:00:00Z'));
    expect(f.severity).toBe('OVERDUE');
    expect(f.overdue).toBe(true);
    expect(f.recommendedAction).toBe('REQUEST_ERASURE');
    expect(f.deleteDueAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(f.ruleSetVersion).toBe(APPLICANT_RETENTION_RULESET_VERSION);
  });

  it('is OK while still inside the window', () => {
    const f = assessApplicantRetention(rec({ rejectedAt: new Date('2026-06-01T00:00:00Z') }), new Date('2026-08-10T00:00:00Z'));
    expect(f.severity).toBe('OK');
    expect(f.recommendedAction).toBe('NONE');
  });

  it('surfaces DUE_SOON within the lead window', () => {
    // rejected 2026-02-01 → due 2026-08-01; now 2026-07-25 is within 14 days.
    const f = assessApplicantRetention(rec({ rejectedAt: new Date('2026-02-01T00:00:00Z') }), new Date('2026-07-25T00:00:00Z'));
    expect(f.severity).toBe('DUE_SOON');
    expect(f.recommendedAction).toBe('MONITOR');
  });

  it('does not treat the exact due moment as overdue (boundary)', () => {
    const f = assessApplicantRetention(rec({ rejectedAt: new Date('2026-01-01T00:00:00Z') }), new Date('2026-07-01T00:00:00Z'));
    expect(f.overdue).toBe(false);
    expect(f.severity).toBe('DUE_SOON'); // at the boundary it is due-now, not yet overdue
  });

  it('does not require deletion while an AGG claim is pending (must retain)', () => {
    const f = assessApplicantRetention(rec({ rejectedAt: new Date('2025-01-01T00:00:00Z'), aggClaimPending: true }), new Date('2026-08-10T00:00:00Z'));
    expect(f.severity).toBe('OK');
    expect(f.overdue).toBe(false);
    expect(f.deleteDueAt).toBeNull();
    expect(f.recommendedAction).toBe('MONITOR');
  });

  it('does not require deletion where the applicant consented to a talent pool', () => {
    const f = assessApplicantRetention(rec({ rejectedAt: new Date('2025-01-01T00:00:00Z'), talentPoolConsent: true }), new Date('2026-08-10T00:00:00Z'));
    expect(f.severity).toBe('OK');
    expect(f.deleteDueAt).toBeNull();
    expect(f.recommendedAction).toBe('NONE');
  });

  it('a pending AGG claim overrides talent-pool consent in the rationale (retain either way)', () => {
    const f = assessApplicantRetention(rec({ aggClaimPending: true, talentPoolConsent: true }), new Date('2027-01-01T00:00:00Z'));
    expect(f.deleteDueAt).toBeNull();
    expect(f.rationale).toMatch(/AGG/);
  });

  it('APPLICANT_RETENTION_MONTHS is the documented ceiling', () => {
    expect(APPLICANT_RETENTION_MONTHS).toBe(6);
  });

  it('asserts the deletion date in the DUE_SOON and OK findings, not only OVERDUE', () => {
    const dueSoon = assessApplicantRetention(rec({ rejectedAt: new Date('2026-02-01T00:00:00Z') }), new Date('2026-07-25T00:00:00Z'));
    expect(dueSoon.deleteDueAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    const ok = assessApplicantRetention(rec({ rejectedAt: new Date('2026-06-01T00:00:00Z') }), new Date('2026-08-10T00:00:00Z'));
    expect(ok.deleteDueAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('retention date edges', () => {
  it('floors the deadline to a whole day regardless of rejection time-of-day', () => {
    // Rejected late in the day; deadline anchors to the rejection DAY, not the instant.
    const f = assessApplicantRetention(rec({ rejectedAt: new Date('2026-01-01T23:59:59Z') }), new Date('2026-07-01T12:00:00Z'));
    expect(f.deleteDueAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(f.severity).toBe('OVERDUE'); // now (12:00) is past the whole-day boundary (00:00)
  });

  it('floorToUtcDay strips the time component', () => {
    expect(floorToUtcDay(new Date('2026-01-10T14:30:45.678Z')).toISOString()).toBe('2026-01-10T00:00:00.000Z');
  });

  it('DUE_SOON lower boundary is exact (window start = DUE_SOON, one ms earlier = OK)', () => {
    const rejectedAt = new Date('2026-02-01T00:00:00Z'); // due 2026-08-01T00:00Z
    const due = new Date('2026-08-01T00:00:00Z').getTime();
    const atWindowStart = new Date(due - 14 * DAY_MS);
    expect(assessApplicantRetention(rec({ rejectedAt }), atWindowStart).severity).toBe('DUE_SOON');
    expect(assessApplicantRetention(rec({ rejectedAt }), new Date(due - 14 * DAY_MS - 1)).severity).toBe('OK');
  });

  it('honours a custom dueSoonDays lead window', () => {
    const rejectedAt = new Date('2026-02-01T00:00:00Z'); // due 2026-08-01
    const now = new Date('2026-07-05T00:00:00Z'); // 27 days out: OK at default 14, DUE_SOON at 30
    expect(assessApplicantRetention(rec({ rejectedAt }), now).severity).toBe('OK');
    expect(assessApplicantRetention(rec({ rejectedAt }), now, { dueSoonDays: 30 }).severity).toBe('DUE_SOON');
  });

  it('addMonthsUTC handles negative months and a December→January crossing', () => {
    expect(addMonthsUTC(new Date('2026-03-15T00:00:00Z'), -6).toISOString()).toBe('2025-09-15T00:00:00.000Z');
    expect(addMonthsUTC(new Date('2026-12-10T00:00:00Z'), 1).toISOString()).toBe('2027-01-10T00:00:00.000Z');
    // month index lands on December (11); last-day path must not overflow.
    expect(addMonthsUTC(new Date('2026-07-31T00:00:00Z'), 5).toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });
});
