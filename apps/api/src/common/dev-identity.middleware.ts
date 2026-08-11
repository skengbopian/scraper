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
  use(req: Record<string, unknown>, _res: unknown, next: () => void): void {
    if (devFixturesEnabled()) {
      req.userId = DEV_USER_ID;
      req.identity = DEV_IDENTITY;
    }
    next();
  }
}
