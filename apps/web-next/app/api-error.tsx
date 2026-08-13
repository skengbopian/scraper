import type { AppStrings } from '@scraper/i18n';

/**
 * What the user is told when an API call fails.
 *
 * The first version of these pages rendered "Keine Verbindung" for EVERY failure, so a signed-in
 * user whose identity was not yet verified — a 403, and an entirely expected state — was told the
 * network was down. That is both wrong and a dead end (docs/09: every screen states the next
 * action). The status decides the message, and 403 carries the one action that resolves it.
 *
 * The API already answers in the caller's register (ADR-034), so its own message is preferred over
 * a local guess wherever it sends one.
 */
export function ApiError({ status, message, s }: { status: number; message: string; s: AppStrings }) {
  if (status === 403) {
    return (
      <>
        <p className="err" role="alert">{message || s.auth.verificationRequired}</p>
        <div className="btnrow">
          <a className="btn primary" href="/konto">{s.account.verifyCta}</a>
        </div>
      </>
    );
  }
  // status 0 is our own marker for "the request never reached the API" (see lib/api.ts).
  return <p className="err" role="alert">{status === 0 ? s.errors.offline : message || s.errors.generic}</p>;
}
