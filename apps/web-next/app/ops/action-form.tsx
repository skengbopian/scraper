'use client';

import { useFormState, useFormStatus } from 'react-dom';

/**
 * One ops form that can SAY WHY it failed (audit W7, ops half).
 *
 * Every button on the review queue posts to an endpoint the state machine may legitimately refuse —
 * another reviewer moved the ticket first (409 STALE_STATE), the mandate was revoked mid-flight
 * (GUARD_MANDATE), nothing proves the controller ever received the request (invariant 4b). Those
 * refusals are correct and they are informative. They were also invisible: the actions returned
 * `void`, so a refused click looked exactly like a slow one, and the only way to find out was to
 * reload and notice the row had not moved.
 *
 * This is deliberately a tiny wrapper rather than a rewrite of the rows. `useFormState` needs a
 * client boundary and a `(prev, formData)` action; everything else about the queue — the server
 * render, the no-JS form post, the fact that nothing here decides anything — stays as it was. With
 * JS off the form still posts and still works; what is lost is only the inline message, and the
 * page re-renders with the unchanged row, which is the pre-existing behaviour rather than a
 * regression.
 */
export function OpsActionForm({
  action,
  fields,
  label,
  className = 'btn',
  children,
}: {
  readonly action: (prev: string | null, formData: FormData) => Promise<string | null>;
  readonly fields: Readonly<Record<string, string>>;
  readonly label: string;
  readonly className?: string;
  /** Extra inputs (the inbox's case-id field), rendered before the button. */
  readonly children?: React.ReactNode;
}) {
  const [error, formAction] = useFormState(action, null);
  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input type="hidden" name={name} value={value} key={name} />
      ))}
      {children}
      <Submit label={label} className={className} />
      {/* role="alert" so a screen reader announces the refusal without the reviewer hunting for it —
          the queue is a keyboard-driven screen and the message can otherwise land off-viewport. */}
      {error ? <small className="err" role="alert">{error}</small> : null}
    </form>
  );
}

function Submit({ label, className }: { label: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {label}
    </button>
  );
}
