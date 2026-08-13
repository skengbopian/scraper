import type { SendOutcome } from './types.js';

/**
 * The human-ops "channel" (docs/04 step 4, ADR §2 defaults table).
 *
 * Phase 0 does not automate web forms, and it does not send a letter it could not render. Both cases
 * come here. Note what this does NOT do: it does not transition the request. There is deliberately
 * no `READY → NEEDS_HUMAN` edge in the state machine, so a request that never reached the wire stays
 * in READY and waits for ops — which is also what makes it re-dispatchable once the blocker clears
 * (a playbook activated by counsel, a form filled by hand) without inventing a recovery edge.
 *
 * A request that HAS reached the wire and failed is a different story: that one is SENT, and
 * `sendPermanentlyFailed` takes it to NEEDS_HUMAN. The gateway decides which of the two happened;
 * this module only names the reason.
 */
export interface HumanQueueEntry {
  readonly requestId: string;
  readonly reason: string;
  readonly queuedAt: Date;
}

export type RecordHumanQueueEntry = (entry: HumanQueueEntry) => Promise<void>;

export function humanQueue(reason: string): Extract<SendOutcome, { kind: 'HUMAN_QUEUE' }> {
  return { kind: 'HUMAN_QUEUE', reason };
}

/** Reasons, named once so the ops queue can group them and tests can assert on them. */
export const HUMAN_QUEUE_REASON = {
  WEB_FORM_NOT_AUTOMATED:
    'the playbook\'s primary channel is a web form, which Phase 0 does not automate (docs/04 step 4). ' +
    'Ops submits it by hand using the identical rendered wording.',
  PLAYBOOK_NOT_SENDABLE:
    'the playbook refused to render. Every shipped playbook is active:false until counsel signs it ' +
    'off, and renderRequest() enforces that — so this is the expected state today, not a fault.',
  NO_PROVABLE_CHANNEL:
    'a registered re-send was authorised but this playbook declares no postal+registered channel, ' +
    'so no provable send is reachable and the Art. 12(3) clock can never start (OQ-26).',
} as const;
