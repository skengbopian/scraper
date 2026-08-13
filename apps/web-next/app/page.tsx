import { strings } from '@/lib/register';
import { readRegister } from '@/lib/register';
import { getControllers, getRequests } from '@/lib/api';
import { CompanyRow } from './company-row';
import { ApiError } from './api-error';

export const dynamic = 'force-dynamic';

/** Start: what is open right now, then the companies worth acting on. */
export default async function StartPage() {
  const s = strings();
  const register = readRegister();
  const [census, cases] = await Promise.all([getControllers(register), getRequests(register)]);

  return (
    <>
      <p className="eyebrow">{s.start.eyebrow}</p>
      <h1>{s.start.greeting.replace('{name}', 'Erika')}</h1>
      <p className="sub">{s.start.sub}</p>

      {!census.ok && <ApiError status={census.status} message={census.message} s={s} />}

      {cases.ok && cases.data.length > 0 && (
        <>
          <h2>{s.case.allCases} ({cases.data.length})</h2>
          <div className="list">
            {cases.data.map((c) => (
              <a className="row" key={c.id} href={`/vorgaenge/${c.id}`}>
                <span className="glyph" style={{ background: 'var(--accent)' }} aria-hidden="true">§</span>
                <span className="txt">
                  <b>{s.requestTypeLabel[c.requestType]}</b>
                  <small>{s.stateLabel[c.state]}</small>
                </span>
              </a>
            ))}
          </div>
        </>
      )}

      {census.ok && (
        <>
          <h2>{s.start.firmsHeading}</h2>
          <div className="list">
            {census.data.filter((c) => c.featured).slice(0, 3).map((c) => (
              <CompanyRow key={c.slug} controller={c} />
            ))}
          </div>
          <div className="btnrow">
            <a className="btn ghost" href="/firmen">{s.start.allFirms}</a>
          </div>
        </>
      )}
    </>
  );
}
