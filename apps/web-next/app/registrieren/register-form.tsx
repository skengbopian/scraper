'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createAccount } from '../auth-actions';

interface Labels {
  email: string; password: string; hint: string; submit: string; alt: string;
  secretHeading: string; secretBody: string; secretOnce: string; toSignIn: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn primary" disabled={pending}>{label}</button>;
}

/**
 * Registration, then the shared secret shown exactly once.
 *
 * The secret is rendered from the action's return value and never written anywhere else — no
 * cookie, no localStorage, no query string. A copy that outlives this render would turn the second
 * factor into a first one.
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
        <div className="btnrow">
          <a className="btn primary" href="/anmelden">{labels.toSignIn}</a>
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
        <input name="password" type="password" autoComplete="new-password" minLength={10} required />
        <small>{labels.hint}</small>
      </label>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <Submit label={labels.submit} />
      <a className="btn ghost" href="/anmelden">{labels.alt}</a>
    </form>
  );
}
