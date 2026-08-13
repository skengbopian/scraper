import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IdentityVerifiedGuard } from '../common/identity-verified.guard.js';
import { CreateRightsRequestDto } from './create-request.dto.js';
import { RequestsService } from './requests.service.js';
import type { VerifiedIdentity } from '@scraper/core';

interface AuthedRequest {
  readonly userId: string;
  readonly identity: VerifiedIdentity;
}

/**
 * The rights-request API.
 *
 * Every route that can cause an outbound legal action sits behind IdentityVerifiedGuard. The two
 * escalation routes additionally require an ops role — the API surface is where "an Art. 77 complaint
 * is never auto-sent" has to hold against an ordinary authenticated caller, not just against the
 * worker.
 */
@Controller('requests')
@UseGuards(IdentityVerifiedGuard)
export class RequestsController {
  constructor(private readonly service: RequestsService) {}

  /**
   * Create a rights request. The subject is derived from `req.identity` — the DTO has no subject
   * field and the body cannot influence whose data is requested.
   */
  @Post()
  async create(@Req() req: AuthedRequest, @Body() dto: CreateRightsRequestDto) {
    return this.service.create({
      userId: req.userId,
      identity: req.identity,
      controllerSlug: dto.controllerSlug,
      requestType: dto.requestType,
      // Always USER_INITIATED here. A chained follow-up is created through the follow-up route below,
      // where the cause is established from stored evidence — see create-request.dto.ts.
      cause: 'USER_INITIATED',
    });
  }

  /**
   * The follow-ups a provenance answer has opened up (docs/09 — the Provenance flagship's last link).
   *
   * Proposals only: each carries `requiresHumanConfirmation: true`, and listing them creates nothing.
   */
  @Get(':id/follow-ups')
  async followUps(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.listFollowUps(req.userId, id);
  }

  /**
   * Confirm one — the human step between a broker named in parser output and an outbound legal
   * request (CLAUDE.md §2). The proposal is re-derived from the stored provenance entries before
   * anything is created, so a caller cannot invent a chain that the evidence does not support.
   */
  @Post(':id/follow-ups/:followUpId/confirm')
  async confirmFollowUp(@Req() req: AuthedRequest, @Param('id') id: string, @Param('followUpId') followUpId: string) {
    return this.service.confirmFollowUp(req.userId, req.identity, id, followUpId);
  }

  /** The user's Vorgänge — what the pipeline screen lists (docs/09 §3). */
  @Get()
  async list(@Req() req: AuthedRequest) {
    return this.service.listForUser(req.userId);
  }

  /** The user-facing pipeline view: Gesendet → Frist läuft → Antwort → Erledigt (docs/09 §3). */
  @Get(':id')
  async get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.getForUser(req.userId, id);
  }

  /**
   * The C1 chase step. The user authorises the registered re-send when a provisional deadline
   * expires — it is a paid action and the first step onto the escalation ladder, so it is theirs.
   * The service re-runs the full guard set (invariant 1: every entry to READY is guarded).
   */
  @Post(':id/registered-resend')
  async confirmResend(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.confirmRegisteredResend(req.userId, req.identity, id);
  }

  @Post(':id/decline-resend')
  async declineResend(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.declineRegisteredResend(req.userId, id);
  }

  /**
   * NOTE: there is deliberately NO route here that sends an Art. 77 complaint. Sending is an ops
   * action performed from the internal review queue by a HUMAN_OPS principal, and the state machine
   * rejects `humanSend` from any other actor. A "send my complaint" button for end users would be a
   * second inbound edge to ESCALATED in everything but name.
   */
}
