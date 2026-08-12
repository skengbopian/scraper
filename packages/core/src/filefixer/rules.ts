/**
 * The CoC retention/error rules engine (docs/10 §2.1 S1–S5, §3.2 P1.5). Pure and deterministic:
 * entries in, findings out, clock injected. Like templates, the rule set is VERSIONED,
 * EFFECTIVE-DATED and COUNSEL-SIGNED (OQ-13) — v1 is unsigned, so every consumer must present
 * findings as preliminary ("vorläufig") until `counselSignedOff` flips with a recorded sign-off.
 *
 * Statutory/CoC bases (docs/10 §2.1; EDPB CoC text linked there — verify before legal use):
 *   IV.1b  settled claims: delete 3 years after settlement; 18 months where settlement came within
 *          100 days of first report AND no further negative entries exist (live at Schufa 1 Jan 2025).
 *   IV.2b  Restschuldbefreiung: flag + covered claims deleted 6 months after RSB (CJEU C-26/22 line).
 *   IV.3a  terminated-contract data: deletion ON REQUEST — privacy-positive but SCORE-NEGATIVE
 *          (oldest-contract/card ballast, 81+69 pts) → always warn first (the docs/10 guardrail).
 *   IV.6   inquiry data: deletion on request after 12 months.
 *   S5     Kreditanfrage↔Konditionsanfrage recode check while the inquiry still scores (12 months).
 *   S2     "BEZAHLT" without an Erledigt date → Art. 16 dispute (Klärungsfall) candidate.
 *
 * NEVER a score promise: explanations state facts and rights (docs/05 §3).
 */
import { SCORE_CRITERIA } from './score-criteria.js';

export interface CreditFileEntryInput {
  readonly id: string;
  readonly entryType: 'NEGATIVE_CLAIM' | 'CONTRACT' | 'INQUIRY' | 'ADDRESS' | 'INSOLVENCY' | 'SCORE' | 'OTHER';
  readonly reportedBy: string | null;
  readonly reportedAt: Date | null;
  readonly settledAt: Date | null;
  readonly amountCents: number | null;
  readonly disputed: boolean;
  /** Parser-extracted marker, uppercased: e.g. RSB, BEZAHLT, KREDITANFRAGE, KONDITIONSANFRAGE. */
  readonly label: string | null;
}

export interface FileFindingDraft {
  readonly entryId: string | null;
  readonly ruleId: string;
  readonly ruleSetVersion: string;
  readonly severity: 'INFO' | 'UPCOMING' | 'OVERDUE';
  readonly computedDeadlineAt: Date | null;
  readonly recommendedAction: 'REQUEST_DELETION' | 'DISPUTE_ART16' | 'REVIEW' | 'NONE';
  readonly scoreRelevance: string | null;
  readonly scoreNegativeWarning: boolean;
  readonly explanation: string;
}

export const COC_RULESET = Object.freeze({
  version: 'coc-v1',
  effectiveFrom: new Date('2026-08-11T00:00:00Z'),
  /** OQ-13: findings are preliminary until a counsel sign-off is recorded against this version. */
  counselSignedOff: false,
  basis: 'EDPB CoC (Verhaltensregeln Auskunfteien) IV.1b/IV.2b/IV.3a/IV.6; docs/10 §2.1 S2/S5',
});

const DAY = 86_400_000;
const UPCOMING_WINDOW_DAYS = 90;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function severityFor(deadline: Date, now: Date): 'INFO' | 'UPCOMING' | 'OVERDUE' {
  if (deadline.getTime() <= now.getTime()) return 'OVERDUE';
  if (deadline.getTime() - now.getTime() <= UPCOMING_WINDOW_DAYS * DAY) return 'UPCOMING';
  return 'INFO';
}

function criterion(id: string): string {
  const c = SCORE_CRITERIA.find((x) => x.id === id);
  return c ? `${c.labelDe} (bis ${c.maxPoints} Punkte)` : id;
}

export function assessCreditFile(entries: readonly CreditFileEntryInput[], now: Date): FileFindingDraft[] {
  const findings: FileFindingDraft[] = [];
  const v = COC_RULESET.version;
  const negatives = entries.filter((e) => e.entryType === 'NEGATIVE_CLAIM' || e.entryType === 'INSOLVENCY');

  for (const e of entries) {
    // --- IV.1b: settled claim, 3 years ---------------------------------------------------------
    if (e.entryType === 'NEGATIVE_CLAIM' && e.settledAt) {
      const deadline = addMonths(e.settledAt, 36);
      const sev = severityFor(deadline, now);
      findings.push({
        entryId: e.id, ruleId: 'COC_IV1B_SETTLED_3Y', ruleSetVersion: v, severity: sev,
        computedDeadlineAt: deadline,
        recommendedAction: sev === 'OVERDUE' ? 'REQUEST_DELETION' : 'NONE',
        scoreRelevance: criterion('ZAHLUNGSSTOERUNGEN'), scoreNegativeWarning: false,
        explanation:
          sev === 'OVERDUE'
            ? 'Die erledigte Forderung ist länger als 3 Jahre erledigt (CoC IV.1b). Die Auskunftei muss den Eintrag löschen — Löschung verlangen.'
            : 'Erledigte Forderung: Löschung fällig 3 Jahre nach Erledigung (CoC IV.1b).',
      });

      // --- IV.1b fast-settle 18 months: settled ≤100 days after report, no further negatives ---
      if (e.reportedAt) {
        const settleDays = Math.floor((e.settledAt.getTime() - e.reportedAt.getTime()) / DAY);
        const noFurtherNegatives = negatives.every((n) => n.id === e.id);
        if (settleDays >= 0 && settleDays <= 100 && noFurtherNegatives) {
          const early = addMonths(e.settledAt, 18);
          const sev18 = severityFor(early, now);
          findings.push({
            entryId: e.id, ruleId: 'COC_IV1B_FAST_SETTLE_18M', ruleSetVersion: v, severity: sev18,
            computedDeadlineAt: early,
            recommendedAction: sev18 === 'OVERDUE' ? 'REQUEST_DELETION' : 'NONE',
            scoreRelevance: criterion('ZAHLUNGSSTOERUNGEN'), scoreNegativeWarning: false,
            explanation:
              'Innerhalb von 100 Tagen beglichen und keine weiteren Negativmerkmale: verkürzte Löschfrist von 18 Monaten (CoC IV.1b, bei der SCHUFA seit 1.1.2025).',
          });
        }
      }
    }

    // --- S2: says BEZAHLT but carries no settlement date ----------------------------------------
    if (e.entryType === 'NEGATIVE_CLAIM' && !e.settledAt && e.label === 'BEZAHLT') {
      findings.push({
        entryId: e.id, ruleId: 'SETTLED_WITHOUT_ERLEDIGT', ruleSetVersion: v, severity: 'OVERDUE',
        computedDeadlineAt: null, recommendedAction: 'DISPUTE_ART16',
        scoreRelevance: criterion('ZAHLUNGSSTOERUNGEN'), scoreNegativeWarning: false,
        explanation:
          'Der Eintrag ist als bezahlt markiert, führt aber kein Erledigt-Datum. Ohne Erledigungsvermerk läuft keine Löschfrist — Berichtigung nach Art. 16 DS-GVO verlangen (Klärungsfall: der Eintrag wird während der Prüfung eingefroren).',
      });
    }

    // --- IV.2b: Restschuldbefreiung, 6 months ---------------------------------------------------
    if (e.entryType === 'INSOLVENCY' && e.label === 'RSB' && e.settledAt) {
      const deadline = addMonths(e.settledAt, 6);
      const sev = severityFor(deadline, now);
      findings.push({
        entryId: e.id, ruleId: 'COC_IV2B_RSB_6M', ruleSetVersion: v, severity: sev,
        computedDeadlineAt: deadline,
        recommendedAction: sev === 'OVERDUE' ? 'REQUEST_DELETION' : 'NONE',
        scoreRelevance: criterion('ZAHLUNGSSTOERUNGEN'), scoreNegativeWarning: false,
        explanation:
          'Restschuldbefreiung: der Vermerk und alle vom Verfahren erfassten Forderungen sind 6 Monate nach Erteilung zu löschen (CoC IV.2b, EuGH C-26/22).',
      });
    }

    // --- IV.3a: terminated contract — on-request right with a SCORE WARNING ---------------------
    if (e.entryType === 'CONTRACT' && e.settledAt) {
      findings.push({
        entryId: e.id, ruleId: 'COC_IV3A_CONTRACT_ON_REQUEST', ruleSetVersion: v, severity: 'INFO',
        computedDeadlineAt: null, recommendedAction: 'REVIEW',
        scoreRelevance: `${criterion('OLDEST_BANK_CONTRACT')}; ${criterion('OLDEST_CREDIT_CARD')}`,
        scoreNegativeWarning: true,
        explanation:
          'Beendeter Vertrag: Sie KÖNNEN die vorzeitige Löschung verlangen (CoC IV.3a). Achtung: alte Vertragsdaten wirken im Score meist positiv („ältester Vertrag/älteste Karte“) — eine Löschung kann den Score verschlechtern. Erst abwägen, dann entscheiden.',
      });
    }

    // --- IV.6: inquiries — on-request deletion after 12 months ----------------------------------
    if (e.entryType === 'INQUIRY' && e.reportedAt) {
      const twelveMonths = addMonths(e.reportedAt, 12);
      if (twelveMonths.getTime() <= now.getTime()) {
        findings.push({
          entryId: e.id, ruleId: 'COC_IV6_INQUIRY_12M', ruleSetVersion: v, severity: 'INFO',
          computedDeadlineAt: twelveMonths, recommendedAction: 'REQUEST_DELETION',
          scoreRelevance: `${criterion('GIRO_KK_12M')}; ${criterion('NONBANK_ANFRAGEN_12M')}`,
          scoreNegativeWarning: false,
          explanation:
            'Anfrage älter als 12 Monate: auf Verlangen zu löschen (CoC IV.6). Anfragen fließen ohnehin nur 12 Monate in den Score ein — die Löschung ist score-neutral.',
        });
      } else if (e.label === 'KREDITANFRAGE') {
        // --- S5: recode check while it still scores ---------------------------------------------
        findings.push({
          entryId: e.id, ruleId: 'INQUIRY_RECODE_CHECK', ruleSetVersion: v, severity: 'INFO',
          computedDeadlineAt: null, recommendedAction: 'REVIEW',
          scoreRelevance: `${criterion('GIRO_KK_12M')}; ${criterion('NONBANK_ANFRAGEN_12M')}`,
          scoreNegativeWarning: false,
          explanation:
            'Als „Kreditanfrage“ vermerkt. Wenn Sie nur Konditionen verglichen haben, gehört hier „Konditionsanfrage“ hin — die ist score-neutral. Umschlüsselung prüfen und ggf. Berichtigung verlangen.',
        });
      }
    }
  }

  return findings;
}
