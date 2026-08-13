import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { stringsFor } from '../common/register.js';

/**
 * Fills in the user-facing `message` on structured auth errors.
 *
 * AuthService throws `{ error, reason }` — machine-readable, and deliberately free of prose, because
 * the service has no request and therefore no idea which of the three copy registers the caller reads
 * (ADR-034). Without this filter that omission is a user-visible regression: the web client falls back
 * to `HTTP 401`, so the German copy this wave added for exactly these cases — a replayed code, a
 * lockout, a bad recovery code — is unreachable, and the screen shows a raw status line instead. The
 * app's own rule is that no screen renders a raw engine code.
 *
 * The mapping lives here rather than in the client so all three registers, and the API's own callers,
 * get the same answer. A reason with no entry keeps its machine code and no prose, which is the honest
 * outcome for something nobody has written copy for yet.
 */
@Catch(HttpException)
export class AuthErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
    const res = ctx.getResponse<{ status(code: number): { json(body: unknown): void } }>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    if (typeof body !== 'object' || body === null || 'message' in body) {
      res.status(status).json(body);
      return;
    }
    const reason = String((body as { reason?: unknown }).reason ?? '');
    const s = stringsFor(req.headers ?? {});
    const message: Record<string, string> = {
      BAD_CREDENTIALS: s.auth.badCredentials,
      MISMATCH: s.auth.badTotp,
      MALFORMED: s.auth.badTotp,
      REPLAYED: s.auth.replayedTotp,
      LOGIN_LOCKED: s.auth.lockedOut,
      MFA_LOCKED: s.auth.lockedOut,
      BAD_RECOVERY_CODE: s.auth.badRecoveryCode,
      STEP_UP_REQUIRED: s.stepUp.required,
      TOO_SHORT: s.auth.passwordHint,
      TOO_LONG: s.auth.passwordHint,
      CONTAINS_EMAIL: s.auth.passwordHint,
      REPEATED_CHARACTER: s.auth.passwordHint,
      COMMON_SEQUENCE: s.auth.passwordHint,
    };
    res.status(status).json(reason in message ? { ...body, message: message[reason] } : body);
  }
}
