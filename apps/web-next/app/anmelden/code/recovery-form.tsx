'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { submitRecoveryCode } from '../../auth-actions';

interface Labels {
  prompt: string;
  code: string;
  submit: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn ghost" disabled={pending}>{label}</button>;
}

/**
 * The way back in without the phone.
 *
 * Inside a <details> because it is the exception, not the path: showing a second code field beside the
 * first would invite people to reach for a single-use credential when their authenticator is right
 * there. Closed by default, but present — the alternative, for an account whose TOTP secret nobody can
 * reset, is a permanent lockout.
 */
export function RecoveryForm({ labels }: { labels: Labels }) {
  const [error, action] = useFormState(submitRecoveryCode, null);

  return (
    <details className="callout" open={error !== null}>
      <summary>{labels.prompt}</summary>
      <form action={action} className="btnrow">
        <label className="field">
          <span>{labels.code}</span>
          <input name="code" autoComplete="off" autoCapitalize="characters" spellCheck={false} required />
        </label>
        {error && <p className="err" role="alert">{error}</p>}
        <Submit label={labels.submit} />
      </form>
    </details>
  );
}
