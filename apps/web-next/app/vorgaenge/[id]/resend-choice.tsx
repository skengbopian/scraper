import { authoriseRegisteredResend, declineResend } from '../../actions';

/**
 * The chase step. The registered re-send is a paid action and the first rung of the escalation
 * ladder, so the USER authorises it (ADR-012) — nothing here happens on a timer.
 *
 * Plain forms, for the same reason as the register switches: this decision must be takeable on a
 * page whose JavaScript never arrived.
 */
export function ResendChoice({ id, confirmLabel, declineLabel }: { id: string; confirmLabel: string; declineLabel: string }) {
  return (
    <div className="btnrow">
      <form action={authoriseRegisteredResend.bind(null, id)}>
        <button type="submit" className="btn primary">{confirmLabel}</button>
      </form>
      <form action={declineResend.bind(null, id)}>
        <button type="submit" className="btn ghost">{declineLabel}</button>
      </form>
    </div>
  );
}
