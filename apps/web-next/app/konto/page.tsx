import { getHealth } from '@/lib/api';
import { readRegister, strings } from '@/lib/register';
import { isSignedIn } from '@/lib/session';
import { AccountActions } from './account-actions';

export const dynamic = 'force-dynamic';

/**
 * The account screen. It reports identity state honestly: an account can exist, be signed in, and
 * still be unable to send anything — that is the identity gate working, not an error, so it is
 * explained rather than hidden.
 */
export default async function AccountPage() {
  const s = strings();
  const signedIn = isSignedIn();
  const health = await getHealth(readRegister());
  const devMode = health.ok && health.data.devFixtures;

  if (!signedIn) {
    return (
      <>
        <h1>{s.account.heading}</h1>
        <p className="sub">{s.account.notSignedIn}</p>
        <div className="btnrow">
          <a className="btn primary" href="/anmelden">{s.auth.signIn}</a>
          <a className="btn ghost" href="/registrieren">{s.auth.register}</a>
        </div>
      </>
    );
  }

  return (
    <>
      <h1>{s.account.heading}</h1>
      <h2>{s.account.identityHeading}</h2>
      <p className="sub">{s.account.identityNote}</p>
      <AccountActions
        labels={{ verify: s.account.verifyCta, signOut: s.account.signOut }}
        showVerify={devMode}
      />
    </>
  );
}
