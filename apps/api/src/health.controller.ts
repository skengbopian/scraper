import { Controller, Get } from '@nestjs/common';
import { devFixturesEnabled } from './common/dev-fixtures.js';

/**
 * Liveness + mode probe. The web alpha calls this to decide between API mode and its built-in
 * standalone demo. No identity guard: it exposes nothing about any user.
 */
@Controller('health')
export class HealthController {
  @Get()
  health(): { ok: true; devFixtures: boolean } {
    return { ok: true, devFixtures: devFixturesEnabled() };
  }
}
