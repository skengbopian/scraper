import { BadRequestException, Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../common/dev-only.guard.js';
import { IdentityVerifiedGuard } from '../common/identity-verified.guard.js';
import { RequestsService, type SimulateAction } from './requests.service.js';

interface AuthedRequest {
  readonly userId: string;
}

class SimulateDto {
  /** dispatch | expire | respond | escalate */
  readonly action!: string;
  /** dispatch only: email (default — provisional clock) | postal_registered (simulated statutory clock) */
  readonly channel?: 'email' | 'postal_registered';
  /** respond only */
  readonly outcome?: 'complied' | 'incomplete' | 'refused' | 'unreadable';
}

/**
 * ALPHA-ONLY simulation surface (404s unless SCRAPER_DEV_FIXTURES=1 — DevOnlyGuard).
 *
 * These endpoints exist so a tester can walk a Vorgang through the REAL state machine — dispatch,
 * clocks, response, validation, escalation draft — without any real send. They call the same
 * `apply()` the production worker will call; nothing here bypasses a guard, and there is still no
 * route into ESCALATED (that edge stays HUMAN_OPS-only, off this API).
 *
 * Prior art for this shape: Consumer Reports' OSIRAA reference agent tests DRP agents against a
 * simulated covered business. Same idea — the counterparty is simulated, the engine is real.
 */
// DevOnlyGuard FIRST: with fixtures off this surface does not exist (404) — it must not even
// disclose itself via a 403 identity error.
@Controller('requests/:id/simulate')
@UseGuards(DevOnlyGuard, IdentityVerifiedGuard)
export class SimulateController {
  constructor(private readonly service: RequestsService) {}

  @Post()
  async simulate(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: SimulateDto) {
    const action = this.parse(dto);
    return this.service.simulate(req.userId, id, action);
  }

  private parse(dto: SimulateDto): SimulateAction {
    switch (dto.action) {
      case 'dispatch':
        if (dto.channel && dto.channel !== 'email' && dto.channel !== 'postal_registered') {
          throw new BadRequestException({ error: 'INVALID_CHANNEL', message: 'channel must be email or postal_registered' });
        }
        return { kind: 'dispatch', channel: dto.channel ?? 'email' };
      case 'expire':
        return { kind: 'expire' };
      case 'respond': {
        const outcomes = ['complied', 'incomplete', 'refused', 'unreadable'] as const;
        if (!dto.outcome || !outcomes.includes(dto.outcome)) {
          throw new BadRequestException({ error: 'INVALID_OUTCOME', message: `outcome must be one of ${outcomes.join(', ')}` });
        }
        return { kind: 'respond', outcome: dto.outcome };
      }
      case 'escalate':
        return { kind: 'escalate' };
      default:
        throw new BadRequestException({ error: 'INVALID_ACTION', message: 'action must be dispatch | expire | respond | escalate' });
    }
  }
}
