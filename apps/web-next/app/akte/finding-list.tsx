import type { AppStrings } from '@scraper/i18n';
import type { CreditFileView, FileFinding } from '@/lib/types';

const SEVERITY_TONE: Record<FileFinding['severity'], string> = {
  OVERDUE: 'crit',
  UPCOMING: 'warn',
  INFO: 'mut',
};

function severityLabel(severity: FileFinding['severity'], s: AppStrings): string {
  return severity === 'OVERDUE' ? s.file.severityOverdue : severity === 'UPCOMING' ? s.file.severityUpcoming : s.file.severityInfo;
}

function actionLabel(action: FileFinding['recommendedAction'], s: AppStrings): string {
  switch (action) {
    case 'REQUEST_DELETION': return s.file.actionRequestDeletion;
    case 'DISPUTE_ART16': return s.file.actionDispute;
    case 'REVIEW': return s.file.actionReview;
    case 'NONE': return s.file.actionNone;
  }
}

/**
 * Findings, with the preliminary badge attached to the SECTION rather than to individual rows —
 * a per-row badge is easy to overlook, and the qualification applies to all of them (OQ-13).
 */
export function FindingList({ view, s }: { view: CreditFileView; s: AppStrings }) {
  if (view.findings.length === 0) {
    return (
      <div className="callout route" style={{ marginTop: 18 }}>
        <div className="kh">{s.file.noFindings}</div>
      </div>
    );
  }
  return (
    <>
      <h2>
        {s.file.findingsHeading}
        {view.ruleSet.preliminary && <span className="tag warn" style={{ marginLeft: 8 }}>{s.file.preliminaryBadge}</span>}
      </h2>
      {view.ruleSet.preliminary && <p className="sub" style={{ marginBottom: 12 }}>{s.file.preliminaryNote}</p>}
      <div className="list">
        {view.findings.map((f, i) => (
          <div className="card" key={`${f.ruleId}-${i}`}>
            <div className="row-head">
              <span className={`tag ${SEVERITY_TONE[f.severity]}`}>{severityLabel(f.severity, s)}</span>
              <strong>{actionLabel(f.recommendedAction, s)}</strong>
            </div>
            <p style={{ fontSize: 14.5, marginTop: 8 }}>{f.explanation}</p>
            {f.computedDeadlineAt && (
              <p className="sub" style={{ fontSize: 13, marginTop: 6 }}>
                {s.file.deadlineLabel}: {new Date(f.computedDeadlineAt).toLocaleDateString('de-DE')}
              </p>
            )}
            {f.scoreNegativeWarning && (
              <p className="warnline">{s.file.scoreWarning}</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
