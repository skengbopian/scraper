import { getControllers } from '@/lib/api';
import { readRegister, strings } from '@/lib/register';
import { CompanyRow } from '../company-row';
import { ApiError } from '../api-error';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const s = strings();
  const census = await getControllers(readRegister());
  return (
    <>
      <h1>{s.firms.heading}</h1>
      <p className="sub">{s.firms.sub}</p>
      {!census.ok ? (
        <ApiError status={census.status} message={census.message} s={s} />
      ) : (
        <div className="list" style={{ marginTop: 16 }}>
          {census.data.map((c) => <CompanyRow key={c.slug} controller={c} />)}
        </div>
      )}
    </>
  );
}
