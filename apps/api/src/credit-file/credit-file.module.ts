import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { IdentityVerifiedGuard } from '../common/identity-verified.guard.js';
import { isPrismaMode } from '../db/db.module.js';
import { CreditFileController } from './credit-file.controller.js';
import { CreditFileService } from './credit-file.service.js';
import { InMemoryCreditFileStore, PrismaCreditFileStore, type CreditFileStore } from './credit-file.store.js';

export const CREDIT_FILE_STORE = Symbol('CreditFileStore');

@Module({
  controllers: [CreditFileController],
  providers: [
    IdentityVerifiedGuard,
    isPrismaMode()
      ? { provide: CREDIT_FILE_STORE, useFactory: (db: PrismaClient) => new PrismaCreditFileStore(db), inject: [PrismaClient] }
      : { provide: CREDIT_FILE_STORE, useFactory: () => new InMemoryCreditFileStore() },
    { provide: CreditFileService, useFactory: (store: CreditFileStore) => new CreditFileService(store), inject: [CREDIT_FILE_STORE] },
  ],
})
export class CreditFileModule {}
