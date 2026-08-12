import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { VerifiedIdentity } from '@scraper/core';
import { IdentityVerifiedGuard } from '../common/identity-verified.guard.js';
import { CreditFileService } from './credit-file.service.js';

interface AuthedRequest {
  readonly userId: string;
  readonly identity: VerifiedIdentity;
  /** express.raw() puts the body here for application/pdf (see main.ts). */
  readonly body: unknown;
}

/**
 * BYO-Datenkopie (docs/10 §3.1). Behind IdentityVerifiedGuard: only a VERIFIED identity can upload,
 * because the match gate needs something verified to match AGAINST. The subject of the ingest is
 * structurally the caller — there is no field naming anyone else, and a document about someone else
 * dies at the match gate before any storage.
 */
@Controller('credit-file')
@UseGuards(IdentityVerifiedGuard)
export class CreditFileController {
  constructor(private readonly service: CreditFileService) {}

  @Post('upload')
  upload(@Req() req: AuthedRequest) {
    const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array(0);
    return this.service.upload(req.userId, req.identity, bytes);
  }

  @Get('findings')
  findings(@Req() req: AuthedRequest) {
    return this.service.findings(req.userId);
  }
}
