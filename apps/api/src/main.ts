import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/**
 * Boot the API.
 *
 * CORS: the alpha web page runs from file:// (Origin "null") or a localhost static server on another
 * port, so dev origins are allowed explicitly. This list is dev-shaped on purpose — the production
 * origin set is a deployment decision, and file://-null must never be allowed there.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, 'null'],
    methods: ['GET', 'POST'],
  });
  // Default :3900 — :3000 is the main Next.js Scraper web app on dev machines.
  const port = Number(process.env.PORT ?? 3900);
  await app.listen(port);
  new Logger('Bootstrap').log(`Scraper API listening on :${port}`);
}

void bootstrap();
