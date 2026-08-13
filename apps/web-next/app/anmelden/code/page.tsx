import { strings } from '@/lib/register';
import { TotpForm } from './totp-form';

export const dynamic = 'force-dynamic';

export default function TotpPage() {
  const s = strings();
  return (
    <>
      <h1>{s.auth.totpHeading}</h1>
      <p className="sub">{s.auth.totpSub}</p>
      <TotpForm labels={{ code: s.auth.totpCode, submit: s.auth.signIn }} />
    </>
  );
}
