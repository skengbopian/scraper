import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * One PrismaClient for the process (Prisma manages pooling). Mounted only in DB mode
 * (SCRAPER_REPOSITORY=prisma); requires DATABASE_URL (EU-region Postgres in any deployed env —
 * docs/02 residency).
 */
export function isPrismaMode(): boolean {
  return process.env.SCRAPER_REPOSITORY === 'prisma';
}

@Global()
@Module({
  providers: [
    {
      provide: PrismaClient,
      useFactory: (): PrismaClient => {
        if (!process.env.DATABASE_URL) {
          throw new Error('SCRAPER_REPOSITORY=prisma requires DATABASE_URL (EU-region Postgres, docs/02)');
        }
        return new PrismaClient();
      },
    },
  ],
  exports: [PrismaClient],
})
export class DbModule {}
