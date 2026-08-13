'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createAccount } from '../auth-actions';

interface Labels {
  email: string; password: string; hint: string; submit: string; alt: string;
  secretHeading: string; secretBody: string; secretOnce: string; toSignIn: string;
  recoveryHeading: string; recoveryBody: string; recoveryOnce: string; recoveryCta: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn primary" disabled={pending}>{label}</button>;
}

/**
 * Registration, then the shared secret AND the recovery codes shown exactly once.
 *
 * Both are rendered from the action's return value and never written anywhere else — no cookie, no
 * localStorage, no query string. A copy of the secret that outlives this render would turn the
 * second factor into a first one; a copy of the recovery codes would be worse, since each is a
 * complete bypass of it. The API keeps only hashes, so this render is genuinely the only chance.
 *
 * The codes matter more here than in an ordinary product: the TOTP secret is encrypted under the
 * user's own key, so nobody at Scraper can reset it for them (CLAUDE.md §4). A lost phone with no
 * code written down is a permanently unreachable account — one that may hold the evidence pack for
 * a legal action in progress.
 */
export function RegisterForm({ labels }: { labels: Labels }) {
  const [state, action] = useFormState(createAccount, {});

  if (state.secret) {
    return (
      <>
        <div className="callout legal">
          <div className="kh">{labels.secretHeading}</div>
          <p>{labels.secretBody}</p>
          <p className="secret">{state.secret}</p>
          <p className="warnline">{labels.secretOnce}</p>
        </div>
        {state.recoveryCodes && state.recoveryCodes.length > 0 && (
          <div className="callout legal">
            <div className="kh">{labels.recoveryHeading}</div>
            <p>{labels.recoveryBody}</p>
            <ul className="codes">
              {state.recoveryCodes.map((c) => (
                <li key={c} className="secret">{c}</li>
              ))}
            </ul>
            <p className="warnline">{labels.recoveryOnce}</p>
          </div>
        )}
        <div className="btnrow">
          <a className="btn primary" href="/anmelden">{state.recoveryCodes?.length ? labels.recoveryCta : labels.toSignIn}</a>
        </div>
      </>
    );
  }

  return (
    <form action={action} className="btnrow">
      <label className="field">
        <span>{labels.email}</span>
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label className="field">
        <span>{labels.password}</span>
        <input name="password" type="password" autoComplete="new-password" minLength={12} required />
        <small>{labels.hint}</small>
      </label>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <Submit label={labels.submit} />
      <a className="btn ghost" href="/anmelden">{labels.alt}</a>
    </form>
  );
}
