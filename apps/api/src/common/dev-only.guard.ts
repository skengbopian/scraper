import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { devFixturesEnabled } from './dev-fixtures.js';

/**
 * Routes that only exist in the alpha (the simulate endpoints) sit behind this guard. When fixtures
 * are off the routes 404 — they are not part of the production API surface, and answering 403 would
 * still admit they exist.
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  canActivate(): boolean {
    if (!devFixturesEnabled()) throw new NotFoundException();
    return true;
  }
}
