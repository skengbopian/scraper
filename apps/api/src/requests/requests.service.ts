import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  apply,
  createRequest,
  type CreateRequestPort,
  type RequestSnapshot,
  type VerifiedIdentity,
} from '@scraper/core';
import { createHash } from 'node:crypto';

export type StatutoryType = 'OBJECTION_ART21' | 'ACCESS_ART15' | 'ACCESS_ART15_SOURCE' | 'ERASURE_ART17';

export interface CreateInput {
  readonly userId: string;
  readonly identity: VerifiedIdentity;
  readonly controllerSlug: string;
  readonly requestType: StatutoryType;
  readonly cause: 'USER_INITIATED' | 'PROVENANCE_CHAIN' | 'FRAUD_REPAIR';
}

/**
 * The persistence port. The creation flow's port (`CreateRequestPort`, in @scraper/core) is extended
 * with the read/transition methods the other endpoints use. The whole create orchestration lives in the
 * core `createRequest()` so it is testable without NestJS; this service is a thin adapter that maps its
 * result union to HTTP responses/exceptions.
 *
 * The adapter should make the routing LeverageAction (SELF_SERVE_ROUTED / NO_ROUTE_AVAILABLE) IDEMPOTENT
 * — upsert keyed on (userId, controllerId, mechanism, day) — so repeated identical POSTs do not accrete
 * rows (the legal path is already deduped by the idempotency guard). TODO(telemetry).
 */
export interface RequestsRepository extends CreateRequestPort {
  load(id: string): Promise<(RequestSnapshot & { userId: string }) | null>;
  applyTransition(id: string, result: unknown): Promise<void>;
}

@Injectable()
export class RequestsService {
  constructor(private readonly repo: RequestsRepository) {}

  /**
   * Create a rights request. The whole orchestration (cheapest-rung-first routing, identity binding, the
   * guard sequence, idempotency, insert) is the core `createRequest()`; this maps its result to HTTP.
   */
  async create(input: CreateInput) {
    const now = new Date();
    const requestId = `req_${createHash('sha256')
      .update(`${input.userId}|${input.controllerSlug}|${input.requestType}|${now.getTime()}`)
      .digest('hex')
      .slice(0, 24)}`;
    const r = await createRequest(this.repo, input, { now, requestId });
    switch (r.kind) {
      case 'CONTROLLER_NOT_FOUND':
        throw new NotFoundException(`unknown controller "${input.controllerSlug}"`);
      case 'IDENTITY_MISMATCH':
        throw new BadRequestException({ error: 'IDENTITY_USER_MISMATCH', message: 'identity does not belong to the caller' });
      case 'GUARD_FAILED':
        throw new BadRequestException({
          error: `GUARD_${r.failed.toUpperCase()}`,
          message: r.reason,
          // Usability gate: never a dead end — every failure names the next action.
          nextAction:
            r.failed === 'identity' ? 'START_IDENTITY_VERIFICATION' : r.failed === 'mandate' ? 'SIGN_MANDATE' : 'VIEW_EXISTING_REQUEST',
        });
      case 'SELF_SERVE':
        return { routed: 'SELF_SERVE' as const, nextAction: 'GUIDED_SELF_SERVE', route: r.route, guided: r.guided, reason: r.reason };
      case 'NO_ROUTE':
        return { routed: 'NONE' as const, nextAction: 'NOT_SUPPORTED', reason: r.reason };
      case 'CREATED':
        return { id: r.id, state: 'READY', routed: 'LEGAL' as const, nextAction: 'AWAIT_DISPATCH' };
    }
  }

  async getForUser(userId: string, id: string) {
    const r = await this.repo.load(id);
    if (!r || r.userId !== userId) throw new NotFoundException();
    return {
      id: r.id,
      state: r.state,
      // Both clocks are exposed, and the provisional one is labelled as NOT statutory so no UI can
      // render it as a legal deadline (CLAUDE.md §6).
      statutoryDeadlineAt: r.deadlineAt,
      provisionalDeadlineAt: r.provisionalDeadlineAt,
      clockIsProvable: r.provableSendConfirmedAt !== null,
      nextAction: this.nextActionFor(r.state),
    };
  }

  async confirmRegisteredResend(userId: string, id: string) {
    const r = await this.repo.load(id);
    if (!r || r.userId !== userId) throw new NotFoundException();
    const result = apply(r, 'userConfirmsResend:guardsPass', { actor: 'USER', now: new Date() });
    await this.repo.applyTransition(id, result);
    return { state: result.to, nextAction: 'AWAIT_DISPATCH' };
  }

  async declineRegisteredResend(userId: string, id: string) {
    const r = await this.repo.load(id);
    if (!r || r.userId !== userId) throw new NotFoundException();
    const result = apply(r, 'userDeclinesResend', { actor: 'USER', now: new Date() });
    await this.repo.applyTransition(id, result);
    return { state: result.to, outcome: result.patch.outcome, nextAction: 'NONE' };
  }

  /** docs/09 usability gate: every state names the user's next action. No dead ends. */
  private nextActionFor(state: string): string {
    const map: Record<string, string> = {
      DRAFT: 'AWAIT_VALIDATION',
      BLOCKED_IDENTITY: 'START_IDENTITY_VERIFICATION',
      READY: 'AWAIT_DISPATCH',
      SENT: 'AWAIT_SEND_CONFIRMATION',
      AWAITING_RESPONSE_PROVISIONAL: 'AWAIT_REPLY',
      AWAITING_RESPONSE: 'AWAIT_REPLY',
      AWAITING_REGISTERED_RESEND: 'CONFIRM_REGISTERED_RESEND',
      RESPONSE_RECEIVED: 'AWAIT_VALIDATION',
      NEEDS_HUMAN: 'AWAIT_OPS_REVIEW',
      COMPLIED: 'NONE',
      INCOMPLETE: 'AWAIT_ESCALATION_DRAFT',
      REFUSED: 'AWAIT_ESCALATION_DRAFT',
      ESCALATION_DRAFTED: 'AWAIT_OPS_SEND',
      ESCALATED: 'AWAIT_DPA_RESPONSE',
      CLOSED_FAILED: 'NONE',
      WITHDRAWN: 'NONE',
    };
    const next = map[state];
    if (!next) throw new Error(`no next action defined for state ${state} — every state must name one`);
    return next;
  }
}
