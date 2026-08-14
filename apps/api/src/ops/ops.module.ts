import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { WorkflowEngine } from '@scraper/core';
import { RequestsModule, SCHEDULER } from '../requests/requests.module.js';
import { OpsController } from './ops.controller.js';
import { OpsRoleGuard } from './ops-role.guard.js';
import { OpsService } from './ops.service.js';

/**
 * Mounted ONLY in DB mode (see AppModule).
 *
 * The guard resolves `User.role` for an authenticated session, and both of those are Prisma-mode
 * facts: the in-memory alpha has no session table and no principal that could hold a role. An ops
 * surface whose authorisation had nothing to read would be authorisation in name only — which is
 * exactly the failure the pre-audit line's header-based stub had, and the reason wave 2c refused to
 * ship the screen at all.
 */
@Module({
  imports: [RequestsModule],
  controllers: [OpsController],
  providers: [
    // Factory for the same reason as RequestsService: the scheduler is injected by token, and the
    // ctor param is an interface with no runtime DI token of its own.
    {
      provide: OpsService,
      useFactory: (db: PrismaClient, scheduler: WorkflowEngine | null) => new OpsService(db, scheduler),
      inject: [PrismaClient, SCHEDULER],
    },
    OpsRoleGuard,
  ],
})
export class OpsModule {}
