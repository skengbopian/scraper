import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  apply,
  createRequest,
  runGuards,
  type CreateRequestPort,
  type RequestSnapshot,
  type RequestTypeStatutory,
  type TransitionResult,
  type VerifiedIdentity,
} from '@scraper/core';
import { createHash } from 'node:crypto';

export type StatutoryType = RequestTypeStatutory;

const STATUTORY_TYPES: readonly StatutoryType[] = ['OBJECTION_ART21', 'ACCESS_ART15', 'ACCESS_ART15_SOURCE', 'ERASURE_ART17'];

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
  listByUser(userId: string): Promise<readonly (RequestSnapshot & { userId: string })[]>;
}

/** The dev-only simulate actions (alpha: no real send ever happens — these drive the REAL machine). */
export type SimulateAction =
  | { readonly kind: 'dispatch'; readonly channel: 'email' | 'postal_registered' }
  | { readonly kind: 'expire' }
  | { readonly kind: 'respond'; readonly outcome: 'complied' | 'incomplete' | 'refused' | 'unreadable' }
  | { readonly kind: 'escalate' };

@Injectable()
export class RequestsService {
  constructor(private readonly repo: RequestsRepository) {}

  /**
   * Create a rights request. The whole orchestration (cheapest-rung-first routing, identity binding, the
   * guard sequence, idempotency, insert) is the core `createRequest()`; this maps its result to HTTP.
   */
  async create(input: CreateInput) {
    if (!STATUTORY_TYPES.includes(input.requestType)) {
      throw new BadRequestException({
        error: 'INVALID_REQUEST_TYPE',
        message: `requestType must be one of ${STATUTORY_TYPES.join(', ')}`,
      });
    }
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
    return this.view(r);
  }

  /** The Vorgänge list (docs/09: the pipeline screen renders from this). */
  async listForUser(userId: string) {
    const rows = await this.repo.listByUser(userId);
    return rows.map((r) => this.view(r));
  }

  /**
   * The C1 chase step, with invariant 1 honoured: EVERY entry to READY re-runs the guard set. A
   * mandate revoked mid-flight, or a duplicate opened meanwhile, must block the re-send here exactly
   * as it would block creation.
   */
  async confirmRegisteredResend(userId: string, identity: VerifiedIdentity, id: string) {
    const r = await this.repo.load(id);
    if (!r || r.userId !== userId) throw new NotFoundException();
    const requestType = r.requestType as RequestTypeStatutory;
    const guards = runGuards({
      requestId: r.id,
      userId,
      controllerId: r.controllerId,
      requestType,
      identity,
      mandates: await this.repo.findLivemandates(userId),
      nonTerminalSiblings: await this.repo.findNonTerminalSiblings(userId, r.controllerId, requestType),
      now: new Date(),
    });
    if (!guards.ok) {
      throw new BadRequestException({
        error: `GUARD_${guards.failed.toUpperCase()}`,
        message: guards.reason,
        nextAction: guards.failed === 'identity' ? 'START_IDENTITY_VERIFICATION' : guards.failed === 'mandate' ? 'SIGN_MANDATE' : 'VIEW_EXISTING_REQUEST',
      });
    }
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

  /**
   * ALPHA ONLY (DevOnlyGuard): drive the REAL state machine through the lifecycle a real dispatch/
   * response would produce, without anything leaving the process. Every edge below is a genuine
   * `apply()` — illegal jumps throw exactly as they would in production. The email channel yields a
   * PROVISIONAL clock only; the simulated registered channel demonstrates the statutory clock with a
   * clearly-marked simulation evidence id (CLAUDE.md §6 semantics are preserved, not bypassed).
   */
  async simulate(userId: string, id: string, action: SimulateAction) {
    const r = await this.repo.load(id);
    if (!r || r.userId !== userId) throw new NotFoundException();
    const now = new Date();
    const step = async (snapshot: RequestSnapshot, event: string, ctx?: Partial<Parameters<typeof apply>[2]>): Promise<TransitionResult> => {
      let result: TransitionResult;
      try {
        result = apply(snapshot, event, { actor: 'SYSTEM', now, ...ctx });
      } catch (e) {
        throw new ConflictException({ error: 'ILLEGAL_TRANSITION', message: (e as Error).message });
      }
      await this.repo.applyTransition(id, result);
      return result;
    };

    switch (action.kind) {
      case 'dispatch': {
        await step(r, 'dispatch');
        const sent = await this.mustLoad(id);
        if (action.channel === 'postal_registered') {
          // Simulated Einwurf-Einschreiben: the machine still demands an evidence id + deadline days;
          // the id is unmistakably a simulation artefact, never a real QTSP anchor.
          await step(sent, 'provableSendConfirmed', { provableSendEvidenceId: `ev_sim_${id}`, deadlineDays: 30 });
        } else {
          await step(sent, 'sendAccepted:nonProvable', { deadlineDays: 30 });
        }
        break;
      }
      case 'expire': {
        if (r.state === 'AWAITING_RESPONSE_PROVISIONAL') await step(r, 'provisionalDeadlineExpired');
        else if (r.state === 'AWAITING_RESPONSE') await step(r, 'deadlineExpired');
        else throw new ConflictException({ error: 'ILLEGAL_TRANSITION', message: `nothing to expire in state ${r.state}` });
        break;
      }
      case 'respond': {
        await step(r, 'responseIngested');
        const received = await this.mustLoad(id);
        // The stubbed parse: unreadable → low confidence → NEEDS_HUMAN (invariant 5); anything else
        // parses cleanly. The confidence floor is the playbook's job in production; the demo uses 0.75.
        const parsed = {
          ...received,
          parseConfidence: action.outcome === 'unreadable' ? 0.2 : 0.95,
          humanReviewIfConfidenceBelow: 0.75,
        };
        await step(parsed, action.outcome === 'unreadable' ? 'lowConfidence|ambiguous' : `validated:${action.outcome}`);
        break;
      }
      case 'escalate': {
        // INCOMPLETE/REFUSED → ESCALATION_DRAFTED. Drafted, never sent: the humanSend edge into
        // ESCALATED requires HUMAN_OPS and has no route on this API (see requests.controller.ts).
        await step(r, 'escalate');
        break;
      }
    }
    const after = await this.mustLoad(id);
    return { ...this.view(after), simulated: true as const };
  }

  private async mustLoad(id: string): Promise<RequestSnapshot & { userId: string }> {
    const r = await this.repo.load(id);
    if (!r) throw new NotFoundException();
    return r;
  }

  private view(r: RequestSnapshot & { userId: string }) {
    return {
      id: r.id,
      controllerId: r.controllerId,
      requestType: r.requestType,
      state: r.state,
      // Both clocks are exposed, and the provisional one is labelled as NOT statutory so no UI can
      // render it as a legal deadline (CLAUDE.md §6).
      statutoryDeadlineAt: r.deadlineAt,
      provisionalDeadlineAt: r.provisionalDeadlineAt,
      clockIsProvable: r.provableSendConfirmedAt !== null,
      outcome: r.outcome,
      nextAction: this.nextActionFor(r.state),
    };
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
