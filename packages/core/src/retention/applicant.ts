/**
 * Applicant-data retention rule engine (docs/10 §7.7 target #2, §7.4).
 *
 * German law lets an employer / its ATS keep a REJECTED applicant's data only for a bounded window after
 * the process ends: AGG §15(4) gives the applicant 2 months to assert a discrimination claim and a
 * further ~3 months to litigate, so ~6 months is the widely-cited practical ceiling before Art. 17
 * deletion is due. Two lawful extensions: a PENDING AGG claim (retain until it concludes) and the
 * applicant's CONSENT to a talent pool (retain until withdrawn).
 *
 * This is a pure, deterministic engine — `now` is injected, never read from the clock — so the same
 * record always yields the same finding, and the rule set is VERSIONED and effective-dated like a
 * counsel-signed document (a retention rule that is wrong deletes or keeps data unlawfully at scale).
 * It states a FACT (a deadline has or has not passed); it never promises an outcome (docs/05 §3).
 *
 * Scope: this is the employer/ATS applicant rule (target #2). The bureau Code-of-Conduct retention
 * schedule (docs/10 §2.1 S2 — settled claims, RSB, inquiries) is a SEPARATE rule set, added later as a
 * sibling assessor on the same shape.
 */

/** Bump on any change to the periods or logic below; a shipped version is never mutated (docs/04 rule). */
export const APPLICANT_RETENTION_RULESET_VERSION = 1;

/**
 * The retention ceiling for rejected-applicant data, in calendar months.
 * TODO(counsel): confirm the exact number and whether it runs from the rejection date or the documented
 * end of the selection process. 6 = AGG's 2-month assertion + 3-month litigation window + buffer.
 */
export const APPLICANT_RETENTION_MONTHS = 6;

export interface ApplicantRecord {
  /**
   * The EMPLOYER (controller) that holds the retention obligation and is the addressee of an Art. 17
   * erasure demand. An ATS/HCM vendor is a PROCESSOR (Art. 28) assisting the employer and cannot decide
   * deletion unilaterally — a demand is routed to the employer, not the ATS (docs/10 §7.3). Some vendors
   * are also independent/joint controllers for their own purposes (Art. 26); a direct-to-vendor route is
   * a census-modelling extension, not the default here.
   */
  readonly controllerSlug: string;
  /**
   * When the applicant was rejected. TODO(counsel): AGG §15(4) starts the 2-month clock at receipt of the
   * rejection (Zugang der Ablehnung), which supports this anchor; confirm whether to clamp to the later
   * of rejection receipt vs a documented end of the selection process (partly OQ-13).
   */
  readonly rejectedAt: Date;
  /**
   * An AGG discrimination claim is being asserted → retention to defend it is lawful (Art. 17(3)(e)) and
   * required until it concludes. TODO(counsel): define the trigger — this should be set on a WRITTEN
   * §15(4) Geltendmachung (not only a filed §61b ArbGG suit), since retention becomes lawful from the
   * written assertion. On conclusion the clock reverts to rejectedAt + window (no fresh period) — confirm.
   */
  readonly aggClaimPending: boolean;
  /**
   * The applicant consented to longer storage (talent pool) → retention lawful until withdrawn.
   * TODO(counsel): consent (Art. 7) is withdrawable and can go stale; decide whether a bounded /
   * periodically re-confirmed talent-pool period is required rather than open-ended storage.
   */
  readonly talentPoolConsent: boolean;
}

export type RetentionSeverity = 'OK' | 'DUE_SOON' | 'OVERDUE';
export type RetentionAction = 'NONE' | 'MONITOR' | 'REQUEST_ERASURE';

/**
 * A retention finding is ADVISORY input to the guarded pipeline (docs/06 C4, docs/10 §7.5). A
 * `REQUEST_ERASURE` recommendation must never auto-dispatch: any erasure it prompts flows through
 * `RequestsService.create()` → `planRequestCreation` → the identity/mandate guards and a human/pipeline
 * gate, never a direct send.
 */
export interface RetentionFinding {
  readonly ruleId: string;
  readonly ruleSetVersion: number;
  readonly severity: RetentionSeverity;
  /** The date deletion becomes due, or null where retention is lawfully extended (claim / consent). */
  readonly deleteDueAt: Date | null;
  readonly overdue: boolean;
  readonly recommendedAction: RetentionAction;
  readonly rationale: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Add `n` calendar months in UTC, clamping to the last day of the target month (Aug 31 + 6mo → Feb 28/29)
 * so a month-end date never rolls into the following month. Deterministic; no local-timezone dependence.
 */
/** Floor a date to UTC midnight, so a retention deadline is a whole-day boundary independent of the
 * ingestion time-of-day (two applicants rejected the same calendar day get the same deletion date). */
export function floorToUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addMonthsUTC(date: Date, n: number): Date {
  const monthIndex = date.getUTCMonth() + n;
  const year = date.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDayOfTargetMonth);
  return new Date(
    Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
  );
}

const RULE_ID = 'applicant.rejected.retention';

/**
 * Assess one rejected-applicant record against the retention rule. `dueSoonDays` is the lead time before
 * the deletion date at which a finding is surfaced as DUE_SOON (default 14).
 */
export function assessApplicantRetention(
  record: ApplicantRecord,
  now: Date,
  opts: { readonly dueSoonDays?: number } = {},
): RetentionFinding {
  const base = { ruleId: RULE_ID, ruleSetVersion: APPLICANT_RETENTION_RULESET_VERSION };

  // A pending claim is the stronger reason to retain — checked before consent.
  if (record.aggClaimPending) {
    return {
      ...base,
      severity: 'OK',
      deleteDueAt: null,
      overdue: false,
      recommendedAction: 'MONITOR',
      rationale: 'An AGG discrimination claim is pending — retention is lawful and required until the proceedings conclude.',
    };
  }
  if (record.talentPoolConsent) {
    return {
      ...base,
      severity: 'OK',
      deleteDueAt: null,
      overdue: false,
      recommendedAction: 'NONE',
      rationale: 'Retention is consented (talent pool) — no deletion is due until the consent is withdrawn.',
    };
  }

  // Anchor to the rejection DAY (UTC midnight) so the deadline is a whole-day boundary, not a sub-day
  // instant that flips mid-day based on the ingestion timestamp.
  const deleteDueAt = addMonthsUTC(floorToUtcDay(record.rejectedAt), APPLICANT_RETENTION_MONTHS);
  const nowMs = now.getTime();
  const dueMs = deleteDueAt.getTime();

  if (nowMs > dueMs) {
    return {
      ...base,
      severity: 'OVERDUE',
      deleteDueAt,
      overdue: true,
      recommendedAction: 'REQUEST_ERASURE',
      rationale: `More than ${APPLICANT_RETENTION_MONTHS} months since rejection with no pending AGG claim or consent — Art. 17 deletion is due.`,
    };
  }

  const dueSoonDays = opts.dueSoonDays ?? 14;
  if (nowMs >= dueMs - dueSoonDays * DAY_MS) {
    return {
      ...base,
      severity: 'DUE_SOON',
      deleteDueAt,
      overdue: false,
      recommendedAction: 'MONITOR',
      rationale: `Deletion is due now or within the next ${dueSoonDays} days.`,
    };
  }

  return {
    ...base,
    severity: 'OK',
    deleteDueAt,
    overdue: false,
    recommendedAction: 'NONE',
    rationale: 'Within the lawful retention window.',
  };
}
