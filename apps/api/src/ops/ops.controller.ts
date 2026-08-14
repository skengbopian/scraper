import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { OpsRoleGuard } from './ops-role.guard.js';
import { OpsService, type OpsResolution } from './ops.service.js';

interface AuthedRequest {
  readonly userId: string;
}

class ResolveDto {
  readonly resolution!: string;
}

class SubmitInboundDto {
  readonly channel!: string;
  readonly senderRef!: string;
  readonly subjectLine?: string;
  readonly storageRef!: string;
  readonly sha256!: string;
}

class AssignInboundDto {
  readonly requestId!: string;
}

/** docs/03 retention: the raw inbound document is purged after the normalisation window. */
const RAW_RETENTION_DAYS = 30;

/**
 * The ops review surface (port wave 5, ADR-037).
 *
 * `OpsRoleGuard` resolves `User.role` for the session `SessionMiddleware` already authenticated —
 * so this module is only mounted in DB mode, where sessions are real. In the in-memory alpha there
 * is no principal to hold a role, and an ops surface authenticated by nothing is worse than none.
 *
 * Note the asymmetry with `RequestsController`, and that it is the point: the user-facing controller
 * has deliberately NO route that sends an Art. 77 complaint, because `humanSend` requires HUMAN_OPS
 * and a "send my complaint" button would be a second inbound edge to ESCALATED in everything but
 * name (ADR-008). The send lives here, behind the role, and nowhere else.
 */
@Controller('ops')
@UseGuards(OpsRoleGuard)
export class OpsController {
  constructor(private readonly service: OpsService) {}

  /** Everything waiting on a person: NEEDS_HUMAN, drafted complaints, and undispatchable requests. */
  @Get('queue')
  async queue() {
    return this.service.queue();
  }

  /** CLAUDE.md C1: the anomaly review queue (audit M3) — SUBJECT_MISMATCH, rate-cap hits, etc. */
  @Get('anomalies')
  async anomalies() {
    return this.service.anomalies();
  }

  @Post('requests/:id/resolve')
  async resolve(@Param('id') id: string, @Body() dto: ResolveDto) {
    const allowed: readonly OpsResolution[] = ['complied', 'incomplete', 'refused', 'escalate', 'resend'];
    if (!allowed.includes(dto.resolution as OpsResolution)) {
      throw new BadRequestException({
        error: 'INVALID_RESOLUTION',
        message: `resolution must be one of ${allowed.join(', ')}`,
      });
    }
    return this.service.resolve(id, dto.resolution as OpsResolution);
  }

  /**
   * THE only route that can reach ESCALATED, and the only actor that can use it is HUMAN_OPS.
   * `tools/spec-audit/statemachine.mjs` asserts by graph analysis that no second inbound edge to
   * ESCALATED exists; this is the code side of that guarantee. Do not add a sibling.
   */
  @Post('requests/:id/escalation/send')
  async sendEscalation(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.sendEscalation(id, req.userId);
  }

  @Post('requests/:id/escalation/discard')
  async discardEscalation(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.service.discardEscalation(id, req.userId);
  }

  @Get('inbound-documents')
  async listInbound() {
    return this.service.listInbound();
  }

  @Post('inbound-documents')
  async submitInbound(@Body() dto: SubmitInboundDto) {
    const channels = ['email', 'postal', 'web_form'] as const;
    if (!channels.includes(dto.channel as (typeof channels)[number])) {
      throw new BadRequestException({ error: 'INVALID_CHANNEL', message: `channel must be one of ${channels.join(', ')}` });
    }
    if (!dto.senderRef || !dto.storageRef || !dto.sha256) {
      throw new BadRequestException({ error: 'INVALID_DOCUMENT', message: 'senderRef, storageRef and sha256 are required' });
    }
    // String() coercion, the auth controllers' pattern (audit W8): there is no global validation
    // pipe, so `senderRef: 42` would otherwise reach `.slice()` and 500 instead of being handled.
    return this.service.submitInboundDocument({
      channel: dto.channel as (typeof channels)[number],
      senderRef: String(dto.senderRef),
      ...(dto.subjectLine ? { subjectLine: String(dto.subjectLine) } : {}),
      storageRef: String(dto.storageRef),
      sha256: String(dto.sha256),
      retentionDays: RAW_RETENTION_DAYS,
    });
  }

  /**
   * Correlate a document to a request — the human step docs/04 keeps human in Phase 0.
   *
   * The request id comes from the ops caller. It is emphatically NOT read from the document: a
   * reply that quotes a reference is a hint for the person reading it, and a hostile PDF that named
   * a request would otherwise be able to close a stranger's statutory request.
   */
  @Post('inbound-documents/:id/assign')
  async assignInbound(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: AssignInboundDto) {
    if (!dto.requestId) throw new BadRequestException({ error: 'INVALID_ASSIGNMENT', message: 'requestId is required' });
    return this.service.assignInboundDocument(id, String(dto.requestId), req.userId);
  }
}
