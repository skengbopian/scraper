import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/**
 * Boot the API. Runs once `@nestjs/*` is installed (pnpm/corepack is broken in the current sandbox, so
 * this is not executed here — the wiring is exercised end to end by the in-memory engine: the
 * `engine-e2e` test and `tools/demo/run-engine.mjs`). The dev wiring uses an in-memory repository; a
 * Prisma adapter (EU-region Postgres) is the production swap. See requests.module.ts.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Scraper API listening on :${port}`);
}

void bootstrap();
