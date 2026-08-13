import {
  apply,
  assessSourceList,
  buildEntries,
  escalationFor,
  proposeFollowUps,
  registeredResendChannel,
  renderRequest,
  runGuards,
  validateResponse,
  type FollowUpProposal,
  type GuardInput,
  type Playbook,
  type ProvenanceEntry,
  type RequestSnapshot,
  type TransitionResult,
} from '@scraper/core';

/**
 * The ACCESS_ART15_SOURCE flagship workflow (docs/09), expressed against the WorkflowEngine
 * interface rather than Temporal directly (ADR-004) so the first milestone is not blocked on
 * operating a Temporal cluster.
 *
 * Everything here is a pure decision function returning what SHOULD happen. Nothing in this file
 * performs I/O. That is deliberate: it keeps the legally-consequential logic testable without a
 * database or a postal account, and it means the durable-execution layer can replay these functions
 * safely.
 */

export interface DispatchPlan {
  readonly channel: 'email' | 'web_form' | 'postal';
  readonly registered: boolean;
  readonly recipient: string;
  /** The event to apply once the provider acknowledges. */
  readonly expectedEvent: 'provableSendConfirmed' | 'sendAccepted:nonProvable' | 'humanQueue';
  readonly reason: string;
}

/**
 * Choose the channel for a dispatch.
 *
 * `forceRegistered` is set when the user has authorised the registered re-send after a provisional
 * deadline expired. Note what this returns for web_form: Phase 0 does not automate forms, so it goes
 * to the human queue rather than pretending to send (docs/04 step 4).
 */
export function planDispatch(pb: Playbook, opts: { forceRegistered: boolean }): DispatchPlan {
  if (opts.forceRegistered) {
    const which = registeredResendChannel(pb);
    if (!which) {
      throw new Error(
        `playbook ${pb.slug} escalates but declares no postal+registered channel, so no provable send ` +
          `is reachable. The schema should have rejected this — see docs/04 §"The channel/clock contract".`,
      );
    }
    const recipient = pb.recipient.postal;
    if (!recipient) throw new Error(`playbook ${pb.slug} has registered.${which} but no postal recipient`);
    return {
      channel: 'postal',
      registered: true,
      recipient,
      expectedEvent: 'provableSendConfirmed',
      reason: 'registered re-send authorised by the user — this is what starts the Art. 12(3) clock',
    };
  }

  const primary = pb.channel.primary;
  const registered = primary === 'postal' && pb.channel.registered?.primary === true;
  const recipient =
    primary === 'email' ? pb.recipient.email : primary === 'postal' ? pb.recipient.postal : pb.recipient.webForm;
  if (!recipient) throw new Error(`playbook ${pb.slug} has channel.primary=${primary} but no matching recipient`);

  if (primary === 'web_form') {
    return {
      channel: 'web_form',
      registered: false,
      recipient,
      expectedEvent: 'humanQueue',
      reason: 'Phase 0 does not automate web forms (docs/04 step 4) — drop to the human queue',
    };
  }

  return {
    channel: primary,
    registered,
    recipient,
    expectedEvent: registered ? 'provableSendConfirmed' : 'sendAccepted:nonProvable',
    reason: registered
      ? 'postal + registered: a provable send, so the statutory clock starts on confirmation'
      : 'email: NOT proof of delivery — sets a provisional deadline only (CLAUDE.md §6)',
  };
}

export interface ProvenanceIngestInput {
  readonly playbook: Playbook;
  readonly request: RequestSnapshot;
  readonly parsed: { readonly text: string; readonly structured: Readonly<Record<string, unknown>>; readonly confidence: number; readonly reviewedByHuman: boolean };
  readonly rawEntries: readonly { dataCategory: string; statedSource: string | null; statedLegalBasis: string | null; confidence: number }[];
  readonly bureauSlug: string;
  readonly now: Date;
}

export interface ProvenanceIngestPlan {
  readonly entries: readonly ProvenanceEntry[];
  readonly transition: TransitionResult;
  /** Drafts for a human to confirm. NEVER dispatched from here. */
  readonly followUpProposals: readonly FollowUpProposal[];
  readonly escalationRoute: 'DRAFT_ART77' | 'NONE';
  readonly notes: readonly string[];
}

/**
 * Ingest a bureau's provenance reply.
 *
 * The ordering matters and is not arbitrary: the confidence floor is applied by `validateResponse`
 * BEFORE any source-list assessment influences the outcome. A hostile PDF must not be able to reach
 * a decision because it happened to contain a matching phrase (docs/06 C4).
 */
export function ingestProvenanceResponse(input: ProvenanceIngestInput): ProvenanceIngestPlan {
  const notes: string[] = [];
  const entries = buildEntries(input.rawEntries, input.playbook);

  const verdict = validateResponse(input.playbook, input.parsed);
  let event: string = verdict.event;

  if (verdict.event === 'validated:complied') {
    // Even a "complied" reply gets the completeness check: a bureau can answer confidently and still
    // omit a category, which is the BayLDA violation the flagship is built to find.
    const assessment = assessSourceList(entries, input.playbook);
    if (assessment.kind === 'INCOMPLETE') {
      event = 'validated:incomplete';
      notes.push(`source list incomplete for: ${assessment.missingCategories.join(', ')}`);
    } else if (assessment.kind === 'CONTRADICTS_ART14') {
      event = 'validated:incomplete';
      notes.push(
        `the answer does not name ${assessment.expectedSource}, which this controller's own Art. 14 ` +
          `notice names as a source — strong Art. 77 material. TODO(counsel): the Art. 14 notice ` +
          `version must be verified before this is used as an escalation trigger.`,
      );
    }
  } else if (verdict.event === 'lowConfidence|ambiguous') {
    notes.push(`routed to human review: ${verdict.reason}`);
  }

  const transition = apply(
    { ...input.request, parseConfidence: input.parsed.confidence, reviewedByHuman: input.parsed.reviewedByHuman },
    event,
    {
      actor: input.parsed.reviewedByHuman ? 'HUMAN_OPS' : 'SYSTEM',
      now: input.now,
      // The notes are what a human needs to act on this ticket — which category was missing, or why
      // the parse was not trusted. They reach the RequestEvent payload, and from there the ops queue.
      ...(notes.length > 0 ? { reason: notes.join('; ') } : {}),
    },
  );

  const brokersNamed = entries.some((e) => e.isBroker);
  const followUpProposals = brokersNamed ? proposeFollowUps(entries, input.bureauSlug) : [];
  if (brokersNamed) {
    notes.push(
      `${followUpProposals.length} follow-up PROPOSALS generated. These are drafts: a broker named in ` +
        `parser output may not auto-spawn an outbound legal request (CLAUDE.md §2).`,
    );
  }

  const escalationRoute =
    transition.to === 'INCOMPLETE'
      ? escalationFor(input.playbook, 'incompleteSourceList')
      : transition.to === 'REFUSED'
        ? escalationFor(input.playbook, 'refusal')
        : 'NONE';

  return { entries, transition, followUpProposals, escalationRoute, notes };
}

/** Guard re-run wrapper for every entry to READY (invariant 1). */
export function enterReady(input: GuardInput): TransitionResult {
  const guards = runGuards(input);
  const snapshot: RequestSnapshot = {
    id: input.requestId, state: 'DRAFT', userId: input.userId, controllerId: input.controllerId,
    requestType: input.requestType, provableSendConfirmedAt: null, deadlineAt: null,
    provisionalDeadlineAt: null, hasControllerResponse: false, reviewedByHuman: false,
    parseConfidence: null, humanReviewIfConfidenceBelow: 1, outcome: null,
  };
  if (guards.ok) return apply(snapshot, 'guardsPass', { actor: 'SYSTEM', now: input.now });
  return apply(
    snapshot,
    guards.failed === 'identity' ? 'guardFail(identity)' : 'guardFail(idempotency|mandate)',
    { actor: 'SYSTEM', now: input.now, reason: guards.reason },
  );
}

export { renderRequest };
