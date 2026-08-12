import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { VerifiedIdentity } from '@scraper/core';
import { stringsFor } from './register.js';

/**
 * docs/06 C1, expressed as a NestJS guard: `createRightsRequest` throws unless the caller's identity
 * is VERIFIED. This is why the API is NestJS (ADR-002) — the safety gates are framework primitives
 * that a route cannot forget to call, rather than middleware someone remembers to add.
 *
 * Note what this guard does NOT do: it does not read a subject from the request body. There is no
 * subject in the body. See `@scraper/core`'s subject module.
 */
@Injectable()
export class IdentityVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ identity?: VerifiedIdentity; headers?: Record<string, string | string[] | undefined> }>();
    const identity = req.identity;
    if (!identity || identity.status !== 'VERIFIED') {
      throw new ForbiddenException({
        error: 'IDENTITY_NOT_VERIFIED',
        // The message is user-facing and must state the next action — docs/09 usability gate,
        // "every screen states the next action, no dead ends". Copy comes from @scraper/i18n so the
        // forbidden-phrase and two-clock tests cover API copy too, not just the UI's (wave 2).
        message: stringsFor(req.headers ?? {}).auth.verificationRequired,
        nextAction: 'START_IDENTITY_VERIFICATION',
      });
    }
    return true;
  }
}
