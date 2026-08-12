/**
 * The new SCHUFA score's twelve published criteria as DATA (docs/10 §2.1; live 17 Mar 2026,
 * scale 100–999). Weights per the published table (Verbraucherzentrale / capitalo, retrieved
 * 2026-08; verify before legal use). This table powers the score-guardrail warnings ("this deletion
 * right is privacy-positive but score-negative") and the "what likely matters in your file"
 * ordering — never a score prediction and never a promise (docs/05 §3).
 *
 * Watch item: § 37a BDSG (in force 20 Nov 2026) bans address data from scoring — the
 * ADDRESS_AGE criterion is in visible tension; re-audit scheduled (docs/10 §2.1, OQ-13).
 */
export interface ScoreCriterion {
  readonly id: string;
  readonly labelDe: string;
  readonly maxPoints: number;
  /** Entry types in the normalised credit file this criterion reads on. */
  readonly affectedBy: readonly ('NEGATIVE_CLAIM' | 'CONTRACT' | 'INQUIRY' | 'ADDRESS' | 'INSOLVENCY' | 'SCORE' | 'OTHER')[];
}

export const SCORE_CRITERIA: readonly ScoreCriterion[] = Object.freeze([
  { id: 'ZAHLUNGSSTOERUNGEN', labelDe: 'Zahlungsstörungen', maxPoints: 264, affectedBy: ['NEGATIVE_CLAIM', 'INSOLVENCY'] },
  { id: 'GIRO_KK_12M', labelDe: 'Girokonto-/Kreditkarten-Anfragen und -Abschlüsse (12 Monate)', maxPoints: 117, affectedBy: ['INQUIRY', 'CONTRACT'] },
  { id: 'NONBANK_ANFRAGEN_12M', labelDe: 'Anfragen außerhalb von Banken (12 Monate)', maxPoints: 99, affectedBy: ['INQUIRY'] },
  { id: 'ADDRESS_AGE', labelDe: 'Alter der aktuellen Adresse', maxPoints: 94, affectedBy: ['ADDRESS'] },
  { id: 'OLDEST_CREDIT_CARD', labelDe: 'Älteste Kreditkarte', maxPoints: 81, affectedBy: ['CONTRACT'] },
  { id: 'OLDEST_BANK_CONTRACT', labelDe: 'Ältester Bankvertrag', maxPoints: 69, affectedBy: ['CONTRACT'] },
  { id: 'NEW_INSTALMENT_12M', labelDe: 'Neue Ratenkredite (12 Monate)', maxPoints: 66, affectedBy: ['CONTRACT'] },
  { id: 'LONGEST_RESIDUAL_TERM', labelDe: 'Längste Restlaufzeit', maxPoints: 61, affectedBy: ['CONTRACT'] },
  { id: 'MORTGAGE', labelDe: 'Immobilienkredit', maxPoints: 55, affectedBy: ['CONTRACT'] },
  { id: 'IDENT_COMPLETED', labelDe: 'Abgeschlossene Identitätsprüfung', maxPoints: 38, affectedBy: ['OTHER'] },
  { id: 'NEWEST_RAHMENKREDIT', labelDe: 'Neuester Rahmenkredit', maxPoints: 36, affectedBy: ['CONTRACT'] },
  { id: 'CREDIT_STATUS', labelDe: 'Kreditstatus', maxPoints: 19, affectedBy: ['CONTRACT'] },
]);
