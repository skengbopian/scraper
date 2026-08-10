import { Module } from '@nestjs/common';
import { ENRICHMENT_BROKER_ROUTES, InMemoryRequestsRepository, SOURCE_HARDENING_ROUTES } from '@scraper/core';
import { IdentityVerifiedGuard } from '../common/identity-verified.guard.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService, type RequestsRepository } from './requests.service.js';

/** DI token for the repository port (an interface has no runtime token of its own). */
export const REQUESTS_REPOSITORY = Symbol('RequestsRepository');

/**
 * DEV wiring: an in-memory repository seeded with the census + self-serve routes, so the app BOOTS and
 * the cheapest-rung routing runs without a database. Every shipped playbook is `active:false`
 * (counsel-gated), so `activePlaybooks` is empty here — controllers with a self-serve route route to a
 * guided handoff, everything else reports NO_ROUTE. No real user data lives here.
 *
 * PRODUCTION replaces this factory with a Prisma adapter (TODO: prisma-requests.repository.ts, gated on
 * `prisma generate` + an EU-region Postgres) that reads controllers, active playbooks, self-serve routes,
 * and mandates from the DB.
 */
function devRepository(): RequestsRepository {
  return new InMemoryRequestsRepository({
    controllers: [
      { slug: 'zoominfo', id: 'c_zoominfo' },
      { slug: 'apollo', id: 'c_apollo' },
      { slug: 'lusha', id: 'c_lusha' },
      { slug: 'cognism', id: 'c_cognism' },
      { slug: 'peopledatalabs', id: 'c_pdl' },
      { slug: 'rocketreach', id: 'c_rr' },
      { slug: 'schufa', id: 'c_schufa' },
      { slug: 'infoscore', id: 'c_infoscore' },
      { slug: 'hirevue', id: 'c_hirevue' },
    ],
    selfServeRoutes: [...ENRICHMENT_BROKER_ROUTES, ...SOURCE_HARDENING_ROUTES],
    activePlaybooks: [], // counsel-gated: nothing is active in the repo yet (ARCHITECTURE-DECISIONS §4)
    mandates: [],
  });
}

@Module({
  controllers: [RequestsController],
  providers: [
    IdentityVerifiedGuard,
    { provide: REQUESTS_REPOSITORY, useFactory: devRepository },
    // The useFactory is LOAD-BEARING: RequestsService's repo param is the interface RequestsRepository,
    // which has no runtime DI token, so Nest cannot resolve it via a bare class/useClass provider. Do not
    // simplify to `RequestsService` (shorthand) without adding @Inject(REQUESTS_REPOSITORY) to the ctor.
    { provide: RequestsService, useFactory: (repo: RequestsRepository) => new RequestsService(repo), inject: [REQUESTS_REPOSITORY] },
  ],
})
export class RequestsModule {}
