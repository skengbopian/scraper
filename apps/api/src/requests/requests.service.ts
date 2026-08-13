import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  apply,
  appendEvidence,
  buildEntries,
  createRequest,
  proposeFollowUps,
  provableSendEvidenceIdOf,
  runGuards,
  UnprovableSendError,
  type CreateRequestPort,
  type FollowUpProposal,
  type ProvenanceEntry,
  type ProvenanceEntryInput,
  type RequestSnapshot,
  type RequestTypeStatutory,
  type TransitionResult,
  type VerifiedIdentity,
} from '@scraper/core';
import {
  DEV_PROVENANCE_ANSWER,
  DEV_PROVENANCE_PLAYBOOK,
  devFixturesEnabled,
  simulatedDeliveryProof,
  SIMULATED_TIMESTAMPER,
} from '../common/dev-fixtures.js';
import { createHash } from 'node:crypto';
import type { WorkflowEngine } from '@scraper/core';

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
  /** Persist the per-category provenance rows a controller's Art. 15(1)(g) answer yielded. */
  saveProvenanceEntries(args: {
    readonly requestId: string;
    readonly userId: string;
    readonly controllerId: string;
    readonly entries: readonly ProvenanceEntry[];
  }): Promise<void>;
  /** Read them back. Empty when the request has no provenance ledger. */
  loadProvenanceEntries(requestId: string): Promise<readonly ProvenanceEntry[]>;
  /** Resolve a controller id back to its slug — a proposal names a controller the user can act on. */
  findControllerSlugById(controllerId: string): Promise<string | null>;
}

/** One follow-up the user may confirm. `id` is stable so a confirmation names a specific proposal. */
export interface FollowUpView extends FollowUpProposal {
  readonly id: string;
}

/** The dev-only simulate actions (alpha: no real send ever happens — these drive the REAL machine). */
export type SimulateAction =
  | { readonly kind: 'dispatch'; readonly channel: 'email' | 'postal_registered' }
  | { readonly kind: 'expire' }
  | { readonly kind: 'respond'; readonly outcome: 'complied' | 'incomplete' | 'refused' | 'unreadable' }
  | { readonly kind: 'escalate' };

@Injectable()
export class RequestsService {
  constructor(
    private readonly repo: RequestsRepository,
    /** Durable deadline timers (pg-boss in DB mode); null in the in-memory alpha, where the
     *  dev-only "Frist ablaufen lassen" button plays the timer's role. */
    private readonly scheduler: WorkflowEngine | null = null,
  ) {}

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
          const refusal = await this.simulateRegisteredSend(id, sent, step, now);
          if (refusal) {
            // Fail closed, exactly as the worker does. Reported rather than thrown: the tester asked
            // to see what a registered send does here, and "it landed in the ops queue because the
            // proof is simulated" IS the answer.
            return { ...this.view(await this.mustLoad(id)), simulated: true as const, refused: refusal };
          }
        } else {
          await step(sent, 'sendAccepted:nonProvable', { deadlineDays: 30 });
        }
        await this.scheduleDeadline(id);
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
        // A provenance answer carries per-category source rows. Persisting them is what turns the
        // reply into the evidence a follow-up can later be DERIVED from, rather than asserted by a
        // caller — see confirmFollowUp, where the chain's cause is established from these rows.
        if (r.requestType === 'ACCESS_ART15_SOURCE' && action.outcome !== 'unreadable' && devFixturesEnabled()) {
          const entries = buildEntries(DEV_PROVENANCE_ANSWER as readonly ProvenanceEntryInput[], DEV_PROVENANCE_PLAYBOOK);
          await this.repo.saveProvenanceEntries({ requestId: id, userId, controllerId: r.controllerId, entries });
        }
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

  /**
   * The follow-ups a provenance answer has made available (docs/09).
   *
   * PROPOSALS ONLY. Every one carries `requiresHumanConfirmation: true` and nothing here creates or
   * sends anything — a broker named in parser output may not spawn an outbound legal request
   * (CLAUDE.md §2). The list is DERIVED from the stored entries on every call rather than persisted,
   * so it cannot drift from the evidence it claims to rest on.
   */
  async listFollowUps(userId: string, id: string): Promise<{ requestId: string; followUps: FollowUpView[] }> {
    const r = await this.repo.load(id);
    if (!r || r.userId !== userId) throw new NotFoundException();
    return { requestId: id, followUps: await this.deriveFollowUps(r) };
  }

  /**
   * Confirm one follow-up — the human step the chain is gated on.
   *
   * The important thing here is what the CALLER does not get to say. `cause: PROVENANCE_CHAIN` unlocks
   * two things: it skips the Art. 12(5) re-exercise cooling (guards.ts `mayOpenNewCycle`) and, since
   * ADR-036, it is what makes an Art. 17(1)(d) erasure lawful at a credit bureau at all — a
   * user-initiated erasure there is refused (docs/07). So the cause is DERIVED from stored evidence:
   * the source request must be this user's, must be a provenance request, and must have produced an
   * entry naming a watchlisted broker. A body field could assert none of that.
   */
  async confirmFollowUp(userId: string, identity: VerifiedIdentity, id: string, followUpId: string) {
    const r = await this.repo.load(id);
    if (!r || r.userId !== userId) throw new NotFoundException();
    const followUps = await this.deriveFollowUps(r);
    const chosen = followUps.find((f) => f.id === followUpId);
    if (!chosen) {
      throw new BadRequestException({
        error: 'UNKNOWN_FOLLOW_UP',
        message: 'no such follow-up for this request — the proposals are derived from the stored answer',
        nextAction: 'VIEW_FOLLOW_UPS',
      });
    }
    return this.create({
      userId,
      identity,
      controllerSlug: chosen.targetControllerSlug,
      requestType: chosen.requestType,
      // Established above from the ledger, never taken from the request body.
      cause: 'PROVENANCE_CHAIN',
    });
  }

  private async deriveFollowUps(r: RequestSnapshot & { userId: string }): Promise<FollowUpView[]> {
    if (r.requestType !== 'ACCESS_ART15_SOURCE') return [];
    const entries = await this.repo.loadProvenanceEntries(r.id);
    if (!entries.some((e) => e.isBroker)) return [];
    // proposeFollowUps names the bureau by SLUG (it is what a follow-up request is addressed to); the
    // snapshot carries the internal id, so resolve it rather than leaking an id into a proposal.
    const bureauSlug = await this.repo.findControllerSlugById(r.controllerId);
    if (!bureauSlug) return [];
    return proposeFollowUps(entries, bureauSlug).map((p, i) => ({
      ...p,
      id: `${p.requestType}:${p.targetControllerSlug}:${i}`,
    }));
  }

  /**
   * The simulated Einwurf-Einschreiben, run through the REAL provable-send constructor.
   *
   * This method used to hand `apply()` the string `ev_sim_<id>` and get a statutory deadline for it.
   * It cannot any more, and that is the wave-5 correction (ADR-037): `provableSendEvidenceId` is a
   * branded type whose only constructor requires a carrier-issued receipt anchored at a real QTSP.
   * The alpha has neither, so this assembles exactly the artefacts a registered dispatch produces,
   * hands them to the same constructor the worker uses, and reports the refusal.
   *
   * Returns null on success (reachable only with a real QTSP + hybrid-mail account configured), or
   * the refusal after routing the request to NEEDS_HUMAN.
   */
  private async simulateRegisteredSend(
    id: string,
    sent: RequestSnapshot,
    step: (s: RequestSnapshot, event: string, ctx?: Record<string, unknown>) => Promise<TransitionResult>,
    now: Date,
  ): Promise<{ reason: string; message: string } | null> {
    const proof = simulatedDeliveryProof(id);
    // Not persisted: a send whose proof is refused has no provable delivery to evidence. The record
    // exists to be CHECKED, which is the only thing it is for here.
    const record = await appendEvidence(
      {
        requestId: id,
        kind: 'POSTAL_PROOF',
        content: `${proof.kind} ${proof.trackingRef} ${proof.deliveredAt.toISOString()}`,
        storageRef: `sim://evidence/${id}/postal-proof-${proof.trackingRef}.txt`,
        prevHash: null,
        now,
        idFactory: () => `ev_sim_${id}`,
      },
      SIMULATED_TIMESTAMPER,
    );
    try {
      const provableSendEvidenceId = provableSendEvidenceIdOf(record, proof);
      await step(sent, 'provableSendConfirmed', { provableSendEvidenceId, deadlineDays: 30 });
      return null;
    } catch (e) {
      if (!(e instanceof UnprovableSendError)) throw e;
      await step(sent, 'sendPermanentlyFailed', { reason: e.message });
      return { reason: e.reason, message: e.message };
    }
  }

  /** Durable Frist timer (docs/10 P0: deadline expiry fires from timers, not demo buttons). */
  private async scheduleDeadline(id: string): Promise<void> {
    if (!this.scheduler) return;
    const r = await this.mustLoad(id);
    if (r.state === 'AWAITING_RESPONSE_PROVISIONAL' && r.provisionalDeadlineAt) {
      await this.scheduler.schedule(`deadline:${id}:provisional`, r.provisionalDeadlineAt, {
        name: 'deadline-expiry',
        payload: { requestId: id, kind: 'provisional' },
      });
    } else if (r.state === 'AWAITING_RESPONSE' && r.deadlineAt) {
      await this.scheduler.schedule(`deadline:${id}:statutory`, r.deadlineAt, {
        name: 'deadline-expiry',
        payload: { requestId: id, kind: 'statutory' },
      });
    }
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
