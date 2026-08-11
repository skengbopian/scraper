import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CensusController } from './census/census.controller.js';
import { DevIdentityMiddleware } from './common/dev-identity.middleware.js';
import { HealthController } from './health.controller.js';
import { RequestsModule } from './requests/requests.module.js';

/**
 * The application root. Phase-0 mounts the rights-request surface (the safety gates are framework
 * guards on that module), the public census, and a health probe. Doc-sandbox, worker and billing are
 * separate services/processes.
 *
 * DevIdentityMiddleware attaches the ONE fixture identity when SCRAPER_DEV_FIXTURES=1 — the alpha's
 * stand-in for real auth + ident-provider. With fixtures off it attaches nothing and every guarded
 * route fail-closes 403 (the correct posture until real auth lands).
 */
@Module({
  imports: [RequestsModule],
  controllers: [HealthController, CensusController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(DevIdentityMiddleware).forRoutes('*');
  }
}
