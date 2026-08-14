import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { assertApiStartupSafe, corsOrigins } from './common/startup-safety.js';

/**
 * Boot the API.
 *
 * CORS: the alpha web page runs from file:// (Origin "null") or a localhost static server on another
 * port, so dev origins are allowed explicitly. Outside development/test the origin list comes from
 * SCRAPER_CORS_ORIGINS, and `assertApiStartupSafe` refuses to boot without it (and without a real
 * KEK mode) rather than serving a deployment with dev posture.
 */
async function bootstrap(): Promise<void> {
  assertApiStartupSafe();
  const app = await NestFactory.create(AppModule);
  // The Datenkopie upload is a raw PDF body (8 MB cap enforced again in the service).
  const express = await import('express');
  app.use('/credit-file/upload', express.default.raw({ type: 'application/pdf', limit: '8mb' }));
  app.enableCors({
    origin: corsOrigins(),
    methods: ['GET', 'POST'],
  });
  // Default :3900 — :3000 is the main Next.js Scraper web app on dev machines.
  const port = Number(process.env.PORT ?? 3900);
  await app.listen(port);
  new Logger('Bootstrap').log(`Scraper API listening on :${port}`);
}

void bootstrap();
