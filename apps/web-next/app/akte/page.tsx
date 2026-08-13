import { getFindings } from '@/lib/api';
import { readRegister, strings } from '@/lib/register';
import { UploadForm } from './upload-form';
import { FindingList } from './finding-list';

export const dynamic = 'force-dynamic';

/**
 * The BYO-Datenkopie surface (docs/10 §3.1) — the roadmap's same-day-utility flagship, and the one
 * screen that produces a result without waiting on a controller.
 *
 * Two honesty rules are structural here, not stylistic:
 *   1. Findings are PRELIMINARY until counsel signs off the rule set (OQ-13). The API says so on
 *      every response (`ruleSet.preliminary`) and this page refuses to render findings without the
 *      badge — see FindingList.
 *   2. A finding whose action would help privacy but HURT the score carries the warning before the
 *      user acts (docs/10 §2.1 score guardrails). Never a promised number, in either direction.
 */
export default async function FilePage() {
  const s = strings();
  const result = await getFindings(readRegister());

  return (
    <>
      <p className="eyebrow">{s.file.eyebrow}</p>
      <h1>{s.file.heading}</h1>
      <p className="sub">{s.file.sub}</p>

      <UploadForm cta={s.file.uploadCta} busy={s.file.uploading} failed={s.file.uploadFailed} note={s.file.identityNote} />

      {!result.ok ? (
        <p className="err" style={{ marginTop: 16 }}>{s.errors.offline}</p>
      ) : result.data.snapshotId === null ? (
        <div className="callout blocked">
          <div className="kh">{s.file.emptyTitle}</div>
          <p>{s.file.emptyBody}</p>
        </div>
      ) : (
        <FindingList view={result.data} s={s} />
      )}
    </>
  );
}
