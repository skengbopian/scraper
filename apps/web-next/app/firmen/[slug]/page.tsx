import { notFound } from 'next/navigation';
import { getControllers } from '@/lib/api';
import { readRegister, strings } from '@/lib/register';
import { StartRequestButton } from './start-request-button';
import { ApiError } from '../../api-error';

export const dynamic = 'force-dynamic';

/**
 * One decision per screen (docs/09 §2), showing the honest engine outcome for this controller.
 *
 * `expectedOutcome` is a HINT for rendering only — the authoritative decision is taken server-side
 * by `planRequestCreation` when the user acts. The screen must therefore stay truthful if the hint
 * and the real answer ever disagree: it promises a route, never a result.
 */
export default async function CompanyPage({ params }: { params: { slug: string } }) {
  const s = strings();
  const census = await getControllers(readRegister());
  if (!census.ok) return <ApiError status={census.status} message={census.message} s={s} />;
  const c = census.data.find((x) => x.slug === params.slug);
  if (!c) notFound();

  return (
    <>
      <p className="eyebrow">{c.type}</p>
      <h1>{c.name}</h1>
      <p className="sub">
        {s.decision.holdsPrefix} <strong>{c.holds}</strong>
      </p>

      {c.expectedOutcome === 'SELF_SERVE' && c.selfServe && (
        <>
          <h2 style={{ marginBottom: 0 }}>{s.decision.selfServeHeading.replace('{firm}', c.name)}</h2>
          <div className="callout route">
            <div className="kh">
              <span className="badge">{s.decision.selfServeBadge}</span> {s.decision.selfServeTitle}
            </div>
            <p>{s.decision.selfServeBody.replace('{firm}', c.name)}</p>
          </div>
          <ol className="steps">
            {c.selfServe.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <div className="btnrow">
            <StartRequestButton
              slug={c.slug}
              requestType={c.defaultRequestType}
              href={c.selfServe.url}
              label={s.decision.selfServeCta}
            />
            <a className="btn ghost" href="/firmen">{s.decision.later}</a>
          </div>
        </>
      )}

      {c.expectedOutcome === 'LEGAL' && (
        <>
          <h2 style={{ marginBottom: 0 }}>{s.decision.legalHeading}</h2>
          <div className="callout legal">
            <div className="kh"><span className="badge">{s.decision.legalBadge}</span></div>
            <p>{s.decision.legalBody}</p>
          </div>
          <div className="btnrow">
            <StartRequestButton slug={c.slug} requestType={c.defaultRequestType} label={s.decision.legalCta} />
            <a className="btn ghost" href="/firmen">{s.decision.later}</a>
          </div>
        </>
      )}

      {c.expectedOutcome === 'NONE' && (
        <>
          <h2 style={{ marginBottom: 0 }}>{s.decision.noneHeading}</h2>
          <div className="callout blocked">
            <div className="kh"><span className="badge">{s.decision.noneBadge}</span> {s.decision.noneTitle}</div>
            <p>{s.decision.noneBody.replace('{firm}', c.name)}</p>
          </div>
          <div className="btnrow">
            <a className="btn ghost" href="/firmen">{s.decision.later}</a>
          </div>
        </>
      )}
    </>
  );
}
