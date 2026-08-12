import { getRequests } from '@/lib/api';
import { readRegister, strings } from '@/lib/register';

export const dynamic = 'force-dynamic';

export default async function CasesPage() {
  const s = strings();
  const cases = await getRequests(readRegister());
  if (!cases.ok) return <p className="err">{s.errors.offline}</p>;
  if (cases.data.length === 0) {
    return (
      <>
        <p className="eyebrow">{s.case.eyebrow}</p>
        <h1>{s.case.noneYetTitle}</h1>
        <p className="sub">{s.case.noneYetBody}</p>
        <div className="btnrow"><a className="btn primary" href="/firmen">{s.case.toFirms}</a></div>
      </>
    );
  }
  return (
    <>
      <p className="eyebrow">{s.case.eyebrow}</p>
      <h1>{s.case.allCases}</h1>
      <div className="list" style={{ marginTop: 16 }}>
        {cases.data.map((c) => {
          const closed = c.state === 'COMPLIED' || c.state === 'CLOSED_FAILED' || c.state === 'WITHDRAWN';
          return (
            <a className="row" key={c.id} href={`/vorgaenge/${c.id}`}>
              <span className="glyph" style={{ background: 'var(--accent)' }} aria-hidden="true">§</span>
              <span className="txt">
                <b>
                  <span>{s.requestTypeLabel[c.requestType]}</span>
                  <span className={`tag ${closed ? 'good' : 'warn'}`}>{closed ? s.case.stepDone : s.case.running}</span>
                </b>
                <small>{s.stateLabel[c.state]}</small>
              </span>
            </a>
          );
        })}
      </div>
    </>
  );
}
