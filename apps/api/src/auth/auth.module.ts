import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DevOnlyGuard } from '../common/dev-only.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { IdentityStubController } from './identity-stub.controller.js';
import { AuthErrorFilter } from './auth-error.filter.js';
import { StepUpGuard } from './step-up.guard.js';

/** Mounted only in DB mode (see AppModule) — auth is meaningless without persistence. */
@Module({
  controllers: [AuthController, IdentityStubController],
  providers: [
    AuthErrorFilter,
    DevOnlyGuard,
    StepUpGuard,
    { provide: AuthService, useFactory: (db: PrismaClient) => new AuthService(db), inject: [PrismaClient] },
  ],
  exports: [StepUpGuard],
})
export class AuthModule {}
