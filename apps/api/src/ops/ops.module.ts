import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Timestamper, WorkflowEngine } from '@scraper/core';
import { RequestsModule, SCHEDULER } from '../requests/requests.module.js';
import { OpsController } from './ops.controller.js';
import { OpsRoleGuard } from './ops-role.guard.js';
import { OpsService } from './ops.service.js';
import { TIMESTAMPER, UnconfiguredTimestamper } from './timestamper.js';

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
    /**
     * The qualified-timestamp client, as a real DI token rather than a constructor default.
     *
     * Two reasons, and neither is testing convenience. First, a QTSP is a vendor like the postal,
     * ident and model providers, and every one of those sits behind an interface so the choice is
     * configuration — this was the last clock-critical dependency still hardwired. Second, the
     * delivery-proof route is the only route in the product that can start an Art. 12(3) clock, and
     * a seam is the only way to exercise its SUCCESS path at all: the branded ProvableSendEvidenceId
     * demands a QUALIFIED anchor, and there is deliberately no dev flag that produces one.
     *
     * A test-only injection is categorically different from a runtime switch. There is still exactly
     * one path to a statutory clock and it runs through whatever this token resolves to; what a test
     * can do is supply a qualified double, which is what every other provider in this repo already
     * allows and what the core evidence tests have always done.
     *
     * TODO(safety): the factory has one branch today because there is one implementation. When a
     * real eIDAS client lands it selects here, on an env var, the same shape as the other providers
     * — and `assertApiStartupSafe` should then refuse a non-dev boot that resolves to the
     * unconfigured one, exactly as it already refuses a dev KEK.
     */
    { provide: TIMESTAMPER, useFactory: () => new UnconfiguredTimestamper() },
    {
      provide: OpsService,
      useFactory: (db: PrismaClient, scheduler: WorkflowEngine | null, timestamper: Timestamper) =>
        new OpsService(db, scheduler, timestamper),
      inject: [PrismaClient, SCHEDULER, TIMESTAMPER],
    },
    OpsRoleGuard,
  ],
})
export class OpsModule {}
