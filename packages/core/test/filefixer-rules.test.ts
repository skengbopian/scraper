import { describe, expect, it } from 'vitest';
import { assessCreditFile, COC_RULESET, type CreditFileEntryInput } from '../src/filefixer/rules.js';
import { SCORE_CRITERIA } from '../src/filefixer/score-criteria.js';

/**
 * The CoC retention/error rules engine (docs/10 §2.1 / §3.2 P1.5). Deterministic date rules —
 * tested exhaustively at their boundaries, because a wrong deadline here becomes a wrong legal
 * claim in a letter later. All rules v1, counsel-pending (OQ-13): the engine itself must say so.
 */

const NOW = new Date('2026-08-11T12:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

function entry(over: Partial<CreditFileEntryInput> & { entryType: CreditFileEntryInput['entryType'] }): CreditFileEntryInput {
  return { id: over.id ?? 'e1', reportedBy: null, reportedAt: null, settledAt: null, amountCents: null, disputed: false, label: null, ...over };
}

describe('rule set metadata', () => {
  it('is versioned, effective-dated and explicitly counsel-pending', () => {
    expect(COC_RULESET.version).toBe('coc-v1');
    expect(COC_RULESET.counselSignedOff).toBe(false);
    expect(COC_RULESET.effectiveFrom.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });
  it('the 12-criteria score table is complete and sums to the published maxima', () => {
    expect(SCORE_CRITERIA).toHaveLength(12);
    expect(Math.max(...SCORE_CRITERIA.map((c) => c.maxPoints))).toBe(264);
    const ids = new Set(SCORE_CRITERIA.map((c) => c.id));
    expect(ids.size).toBe(12);
  });
});

describe('IV.1b — settled claims, 3-year deletion', () => {
  it('flags OVERDUE when settled more than 3 years ago', () => {
    const f = assessCreditFile([entry({ id: 'n1', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2022-01-10'), settledAt: d('2023-06-01') })], NOW);
    const hit = f.find((x) => x.ruleId === 'COC_IV1B_SETTLED_3Y');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('OVERDUE');
    expect(hit?.computedDeadlineAt?.toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(hit?.recommendedAction).toBe('REQUEST_DELETION');
  });
  it('is UPCOMING inside the 90-day window before the deadline', () => {
    const f = assessCreditFile([entry({ id: 'n2', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2022-01-10'), settledAt: d('2023-10-01') })], NOW);
    expect(f.find((x) => x.ruleId === 'COC_IV1B_SETTLED_3Y')?.severity).toBe('UPCOMING');
  });
  it('is silent when the deadline is far away and the claim is open', () => {
    const open = assessCreditFile([entry({ id: 'n3', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2026-01-01') })], NOW);
    expect(open.find((x) => x.ruleId === 'COC_IV1B_SETTLED_3Y')).toBeUndefined();
    const fresh = assessCreditFile([entry({ id: 'n4', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2026-01-01'), settledAt: d('2026-02-01') })], NOW);
    expect(fresh.find((x) => x.ruleId === 'COC_IV1B_SETTLED_3Y')?.severity).toBe('INFO');
  });
});

describe('IV.1b — 18-month early deletion (settled ≤100 days, no further negatives)', () => {
  const fast = entry({ id: 'f1', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2024-11-01'), settledAt: d('2025-01-30') }); // 90 days
  it('fires when settled within 100 days and file has no other negative', () => {
    const f = assessCreditFile([fast], NOW);
    const hit = f.find((x) => x.ruleId === 'COC_IV1B_FAST_SETTLE_18M');
    expect(hit?.computedDeadlineAt?.toISOString().slice(0, 10)).toBe('2026-07-30'); // +18 months
    expect(hit?.severity).toBe('OVERDUE');
  });
  it('does NOT fire when settled after 100 days', () => {
    const slow = entry({ id: 'f2', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2024-11-01'), settledAt: d('2025-02-20') }); // 111 days
    expect(assessCreditFile([slow], NOW).find((x) => x.ruleId === 'COC_IV1B_FAST_SETTLE_18M')).toBeUndefined();
  });
  it('does NOT fire when another negative entry exists (condition is file-wide)', () => {
    const other = entry({ id: 'f3', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2025-06-01') });
    expect(assessCreditFile([fast, other], NOW).find((x) => x.ruleId === 'COC_IV1B_FAST_SETTLE_18M')).toBeUndefined();
  });
  it('boundary: exactly 100 days still qualifies', () => {
    const exact = entry({ id: 'f4', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2024-11-01'), settledAt: d('2025-02-09') }); // 100 days
    expect(assessCreditFile([exact], NOW).find((x) => x.ruleId === 'COC_IV1B_FAST_SETTLE_18M')).toBeDefined();
  });
});

describe('IV.2b — Restschuldbefreiung, 6-month deletion', () => {
  it('flags the RSB flag and everything it covers', () => {
    const f = assessCreditFile([entry({ id: 'r1', entryType: 'INSOLVENCY', label: 'RSB', settledAt: d('2025-11-01') })], NOW);
    const hit = f.find((x) => x.ruleId === 'COC_IV2B_RSB_6M');
    expect(hit?.severity).toBe('OVERDUE');
    expect(hit?.computedDeadlineAt?.toISOString().slice(0, 10)).toBe('2026-05-01');
  });
});

describe('IV.3a — terminated contract data: right exists but is SCORE-NEGATIVE', () => {
  it('always carries the score warning (docs/10 guardrail: warn before recommend)', () => {
    const f = assessCreditFile([entry({ id: 'c1', entryType: 'CONTRACT', reportedAt: d('2019-01-01'), settledAt: d('2022-01-01') })], NOW);
    const hit = f.find((x) => x.ruleId === 'COC_IV3A_CONTRACT_ON_REQUEST');
    expect(hit).toBeDefined();
    expect(hit?.scoreNegativeWarning).toBe(true);
    expect(hit?.severity).toBe('INFO'); // a choice, never an urgent to-do
    expect(hit?.explanation).toMatch(/Score/);
  });
  it('does not fire for live contracts', () => {
    const f = assessCreditFile([entry({ id: 'c2', entryType: 'CONTRACT', reportedAt: d('2019-01-01') })], NOW);
    expect(f.find((x) => x.ruleId === 'COC_IV3A_CONTRACT_ON_REQUEST')).toBeUndefined();
  });
});

describe('IV.6 — inquiry data: on-request deletion after 12 months', () => {
  it('fires for inquiries older than 12 months', () => {
    const f = assessCreditFile([entry({ id: 'i1', entryType: 'INQUIRY', reportedAt: d('2025-06-01'), label: 'KREDITANFRAGE' })], NOW);
    const hit = f.find((x) => x.ruleId === 'COC_IV6_INQUIRY_12M');
    expect(hit?.severity).toBe('INFO');
    expect(hit?.recommendedAction).toBe('REQUEST_DELETION');
  });
  it('stays silent for recent inquiries', () => {
    const f = assessCreditFile([entry({ id: 'i2', entryType: 'INQUIRY', reportedAt: d('2026-01-01'), label: 'KREDITANFRAGE' })], NOW);
    expect(f.find((x) => x.ruleId === 'COC_IV6_INQUIRY_12M')).toBeUndefined();
  });
});

describe('S5 — Kreditanfrage inside the scoring window: recode check', () => {
  it('advises the Konditionsanfrage recode check only within 12 months', () => {
    const recent = assessCreditFile([entry({ id: 'k1', entryType: 'INQUIRY', reportedAt: d('2026-02-01'), label: 'KREDITANFRAGE' })], NOW);
    expect(recent.find((x) => x.ruleId === 'INQUIRY_RECODE_CHECK')).toBeDefined();
    const old = assessCreditFile([entry({ id: 'k2', entryType: 'INQUIRY', reportedAt: d('2025-01-01'), label: 'KREDITANFRAGE' })], NOW);
    expect(old.find((x) => x.ruleId === 'INQUIRY_RECODE_CHECK')).toBeUndefined();
  });
  it('never fires for Konditionsanfragen (they are already the harmless kind)', () => {
    const f = assessCreditFile([entry({ id: 'k3', entryType: 'INQUIRY', reportedAt: d('2026-02-01'), label: 'KONDITIONSANFRAGE' })], NOW);
    expect(f.find((x) => x.ruleId === 'INQUIRY_RECODE_CHECK')).toBeUndefined();
  });
});

describe('S2 — paid but not marked settled', () => {
  it('flags a dispute when the entry says BEZAHLT without an Erledigt date', () => {
    const f = assessCreditFile([entry({ id: 's1', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2024-01-01'), label: 'BEZAHLT' })], NOW);
    const hit = f.find((x) => x.ruleId === 'SETTLED_WITHOUT_ERLEDIGT');
    expect(hit?.severity).toBe('OVERDUE');
    expect(hit?.recommendedAction).toBe('DISPUTE_ART16');
  });
});

describe('engine hygiene', () => {
  it('an empty file yields no findings', () => {
    expect(assessCreditFile([], NOW)).toHaveLength(0);
  });
  it('every finding names its rule set version and never promises a score change', () => {
    const f = assessCreditFile(
      [entry({ id: 'x1', entryType: 'NEGATIVE_CLAIM', reportedAt: d('2022-01-01'), settledAt: d('2022-06-01') })],
      NOW,
    );
    for (const finding of f) {
      expect(finding.ruleSetVersion).toBe('coc-v1');
      expect(finding.explanation).not.toMatch(/garantier|verspr[ei]ch|Score steigt/i);
    }
  });
});
