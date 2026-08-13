'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { submitTotp } from '../../auth-actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn primary" disabled={pending}>{label}</button>;
}

export function TotpForm({ labels }: { labels: { code: string; submit: string } }) {
  const [error, action] = useFormState(submitTotp, null);
  return (
    <form action={action} className="btnrow">
      <label className="field">
        <span>{labels.code}</span>
        {/* inputMode numeric + autocomplete one-time-code: the phone shows a number pad and offers
            the code from the authenticator app, which matters on the mid-range Android target. */}
        <input name="code" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="one-time-code" required />
      </label>
      {error && <p className="err" role="alert">{error}</p>}
      <Submit label={labels.submit} />
    </form>
  );
}
