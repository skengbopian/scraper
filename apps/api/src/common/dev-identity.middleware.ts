import { Injectable, NestMiddleware } from '@nestjs/common';
import { DEV_IDENTITY, DEV_USER_ID, devFixturesEnabled } from './dev-fixtures.js';

/**
 * Attaches the FIXTURE identity to every request when dev fixtures are enabled.
 *
 * This is the alpha's stand-in for the real auth + IdentityProvider flow (docs/02): in production a
 * session resolves the caller's user and their identity-verification record; here the one fixture
 * tester is attached. Deliberately NOT configurable per request: no header can vary the subject, so
 * the API's "the subject is always the verified caller" property is preserved even in dev.
 *
 * With fixtures off this middleware attaches nothing, and IdentityVerifiedGuard fail-closes every
 * route with 403 — which is the correct production posture until real auth lands.
 */
@Injectable()
export class DevIdentityMiddleware implements NestMiddleware {
  use(req: Record<string, unknown> & { headers?: Record<string, unknown> }, _res: unknown, next: () => void): void {
    // The fixture only fills a TRUE vacuum: no resolved session AND no Bearer header at all. A
    // request that presents a token is trying to be a real session — if that session is missing,
    // expired, or not MFA-verified, it must fail closed as itself, never fall back to the fixture
    // (a half-authenticated caller acting as the fixture user would mask every auth gate).
    const hasBearer = typeof req.headers?.authorization === 'string' && req.headers.authorization.length > 0;
    if (devFixturesEnabled() && req.userId === undefined && !hasBearer) {
      req.userId = DEV_USER_ID;
      req.identity = DEV_IDENTITY;
      // The fixture stands in for the whole auth flow, so it must stand in for step-up too (port
      // wave 3). Without this the alpha's own Akte screen would 403 at StepUpGuard with no way to
      // clear it — there is no session to re-confirm against. It is granted ONLY on the same true
      // vacuum as the identity: the moment a real Bearer token exists this branch does not run, so a
      // real session must still earn step-up at POST /auth/step-up.
      req.stepUp = true;
    }
    next();
  }
}
