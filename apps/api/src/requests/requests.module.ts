import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ENRICHMENT_BROKER_ROUTES, InMemoryRequestsRepository, SOURCE_HARDENING_ROUTES } from '@scraper/core';
import { CENSUS } from '../census/census.js';
import { DEV_DEMO_PLAYBOOK_PAIRS, DEV_MANDATE, devFixturesEnabled } from '../common/dev-fixtures.js';
import { IdentityVerifiedGuard } from '../common/identity-verified.guard.js';
import { isPrismaMode } from '../db/db.module.js';
import { PrismaRequestsRepository } from './prisma-requests.repository.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService, type RequestsRepository } from './requests.service.js';
import { SimulateController } from './simulate.controller.js';

/** DI token for the repository port (an interface has no runtime token of its own). */
export const REQUESTS_REPOSITORY = Symbol('RequestsRepository');

/**
 * DEV wiring: an in-memory repository seeded from the census + self-serve routes, so the app BOOTS and
 * the cheapest-rung routing runs without a database. Every shipped playbook is `active:false`
 * (counsel-gated), so with fixtures OFF `activePlaybooks` is empty — controllers with a self-serve
 * route go to a guided handoff, everything else reports NO_ROUTE, and no LEGAL request can be created.
 *
 * With SCRAPER_DEV_FIXTURES=1 (the alpha), the seed adds the DEMO playbook markers + the fixture
 * mandate so a tester can walk the LEGAL branch through the real machine with SIMULATED dispatch only
 * (see SimulateController). That mechanism does not activate anything in playbooks/.
 *
 * PRODUCTION replaces this factory with a Prisma adapter (TODO: prisma-requests.repository.ts, gated on
 * `prisma generate` + an EU-region Postgres) that reads controllers, active playbooks, self-serve routes,
 * and mandates from the DB.
 */
function devRepository(): RequestsRepository {
  const fixtures = devFixturesEnabled();
  return new InMemoryRequestsRepository({
    controllers: CENSUS.map((c) => ({ slug: c.slug, id: c.id })),
    selfServeRoutes: [...ENRICHMENT_BROKER_ROUTES, ...SOURCE_HARDENING_ROUTES],
    activePlaybooks: fixtures ? [...DEV_DEMO_PLAYBOOK_PAIRS] : [],
    mandates: fixtures ? [DEV_MANDATE] : [],
  });
}

@Module({
  controllers: [RequestsController, SimulateController],
  providers: [
    IdentityVerifiedGuard,
    // memory (default): in-memory seeded adapter. prisma: the packages/db-backed adapter — the
    // PrismaClient comes from the @Global DbModule, mounted by AppModule in that mode.
    isPrismaMode()
      ? { provide: REQUESTS_REPOSITORY, useFactory: (db: PrismaClient) => new PrismaRequestsRepository(db), inject: [PrismaClient] }
      : { provide: REQUESTS_REPOSITORY, useFactory: devRepository },
    // The useFactory is LOAD-BEARING: RequestsService's repo param is the interface RequestsRepository,
    // which has no runtime DI token, so Nest cannot resolve it via a bare class/useClass provider. Do not
    // simplify to `RequestsService` (shorthand) without adding @Inject(REQUESTS_REPOSITORY) to the ctor.
    { provide: RequestsService, useFactory: (repo: RequestsRepository) => new RequestsService(repo), inject: [REQUESTS_REPOSITORY] },
  ],
})
export class RequestsModule {}
