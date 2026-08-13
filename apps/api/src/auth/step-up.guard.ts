import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { stringsFor } from '../common/register.js';

/**
 * Step-up gate (docs/06 C1/C2) for any route that RELEASES content a controller returned about the
 * user — the credit file and the assembled data map.
 *
 * `req.stepUp` is set by SessionMiddleware from the session row's `stepUpAt`, which is written only
 * by a fresh second-factor challenge at `POST /auth/step-up`. A client cannot assert it: there is no
 * header, body field or query parameter that reaches it, and the database refuses a `stepUpAt`
 * without an `mfaCompletedAt` (session_stepup_requires_mfa).
 *
 * The order this was built in matters and is worth stating, because the reverse is the trap: the
 * pre-audit line's version of this file is 23 lines that read one flag, and ported on its own it
 * would be a guard that can never fire — every request would either be denied or, worse, allowed by
 * an `undefined` treated as truthy. The flag, the column, the route that writes it and the
 * middleware that reads it all landed before this file did.
 *
 * TODO(safety): this delivers the FIRST half of CLAUDE.md's high-sensitivity rule (step-up before
 * release). The second half — "for high-sensitivity data, only to the verified POSTAL address" — is
 * NOT implemented, here or anywhere in this repo, and the pre-audit line does not satisfy it either
 * (its own dsr.service.ts admits as much). Nothing below should be read as meeting that rule.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ stepUp?: boolean; headers?: Record<string, string | string[] | undefined> }>();
    // Strict equality, not truthiness: `undefined` — the shape of "no session resolved this" — must
    // deny, and a middleware that failed to run must never read as permission.
    if (request.stepUp !== true) {
      throw new ForbiddenException({
        error: 'STEP_UP_REQUIRED',
        reason: 'STEP_UP_REQUIRED',
        // Copy from @scraper/i18n so API copy is covered by the same forbidden-phrase and register
        // tests as the UI's (wave 2a) — and so a 403 here is readable in Leichte Sprache too.
        message: stringsFor(request.headers ?? {}).stepUp.required,
        // Usability gate (docs/09): every failure names the next action, never a dead end.
        nextAction: 'CONFIRM_SECOND_FACTOR',
      });
    }
    return true;
  }
}
