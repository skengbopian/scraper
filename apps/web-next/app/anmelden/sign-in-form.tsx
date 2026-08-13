'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { signIn } from '../auth-actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn primary" disabled={pending}>{label}</button>;
}

/**
 * Step 1 of sign-in. A real <form> with a server action: it works before hydration, and the
 * password never passes through client-side state.
 */
export function SignInForm({ labels }: { labels: { email: string; password: string; submit: string; alt: string } }) {
  const [error, action] = useFormState(signIn, null);
  return (
    <form action={action} className="btnrow">
      <label className="field">
        <span>{labels.email}</span>
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label className="field">
        <span>{labels.password}</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && <p className="err" role="alert">{error}</p>}
      <Submit label={labels.submit} />
      <a className="btn ghost" href="/registrieren">{labels.alt}</a>
    </form>
  );
}
