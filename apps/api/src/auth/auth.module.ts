import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DevOnlyGuard } from '../common/dev-only.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { IdentityStubController } from './identity-stub.controller.js';

/** Mounted only in DB mode (see AppModule) — auth is meaningless without persistence. */
@Module({
  controllers: [AuthController, IdentityStubController],
  providers: [
    DevOnlyGuard,
    { provide: AuthService, useFactory: (db: PrismaClient) => new AuthService(db), inject: [PrismaClient] },
  ],
})
export class AuthModule {}
