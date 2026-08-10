import { Module } from '@nestjs/common';
import { RequestsModule } from './requests/requests.module.js';

/**
 * The application root. Phase-0 mounts only the rights-request surface (the safety gates are framework
 * guards on that module). Doc-sandbox, worker and billing are separate services/processes.
 */
@Module({
  imports: [RequestsModule],
})
export class AppModule {}
