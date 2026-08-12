import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { SessionMiddleware } from './auth/session.middleware.js';
import { CensusController } from './census/census.controller.js';
import { DbModule, isPrismaMode } from './db/db.module.js';
import { DevIdentityMiddleware } from './common/dev-identity.middleware.js';
import { HealthController } from './health.controller.js';
import { RequestsModule } from './requests/requests.module.js';

/**
 * DB-mode session resolution. Lives in its own module so the middleware is registered (and its
 * PrismaClient dependency resolvable) ONLY when DbModule is mounted. Nest configures imported
 * modules before the importing module, so the order is: SessionMiddleware (real session, DB mode)
 * → DevIdentityMiddleware (fixture fills the vacuum, dev only).
 */
@Module({
  imports: [DbModule],
  providers: [SessionMiddleware],
})
class SessionModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionMiddleware).forRoutes('*');
  }
}

/**
 * The application root. Phase-0 mounts the rights-request surface (the safety gates are framework
 * guards on that module), the public census, and a health probe. Doc-sandbox, worker and billing are
 * separate services/processes.
 *
 * Repository modes (SCRAPER_REPOSITORY):
 *   memory (default) — in-memory adapter + dev-fixture identity: the standalone testing alpha.
 *   prisma           — Postgres via packages/db: real auth (email+password+TOTP) mounts and
 *                      sessions resolve to the caller's own identity.
 */
@Module({
  imports: [...(isPrismaMode() ? [DbModule, SessionModule, AuthModule] : []), RequestsModule],
  controllers: [HealthController, CensusController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(DevIdentityMiddleware).forRoutes('*');
  }
}
