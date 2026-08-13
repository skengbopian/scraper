'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { confirmStepUp } from '../auth-actions';

interface Labels {
  code: string;
  submit: string;
  note: string;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn primary" disabled={pending}>{label}</button>;
}

/**
 * The step-up challenge. A plain `<form>` posting to a server action, like the register switches
 * (wave 2b) — it works before hydration and with JavaScript disabled, which for the screen standing
 * between a user and their own credit file is the difference between a gate and a wall.
 */
export function StepUpForm({ next, labels }: { next: string; labels: Labels }) {
  const [error, action] = useFormState(confirmStepUp, null);

  return (
    <form action={action} className="btnrow">
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span>{labels.code}</span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
        />
      </label>
      {error && <p className="err" role="alert">{error}</p>}
      <Submit label={labels.submit} />
      <small>{labels.note}</small>
    </form>
  );
}
