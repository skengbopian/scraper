import type { Channel, ProvableSendEvidenceId } from '@scraper/core';

/**
 * What a channel adapter is allowed to report — port wave 5, re-derived (ADR-037).
 *
 * THIS TYPE IS THE FIX. The pre-audit line's channel adapters returned
 * `{ providerRef, provable: boolean }`, and its email adapter hardcoded `provable: true` with a
 * TODO admitting it (`apps/worker/src/channels/email.ts:22`). Its dispatch workflow then branched on
 * that boolean and applied `provableSendConfirmed`, so an EMAIL started the Art. 12(3) clock — the
 * C1 violation this whole line exists to remove.
 *
 * A boolean was the wrong shape. "Provable" is not an opinion a sender holds about its own send; it
 * is a pair of external facts (a carrier issued a receipt, a QTSP anchored it) that only the postal
 * path can ever possess. So there is no boolean here. There is a discriminated union, and the email
 * adapter's return type is narrowed to the variants it can honestly produce — making
 * `sendLegalRequestEmail()` returning a provable outcome a COMPILE error rather than a code review.
 */
export type SendOutcome =
  | {
      /** The provider accepted it. Proves we sent, not that they received (CLAUDE.md §6). */
      readonly kind: 'ACCEPTED_NON_PROVABLE';
      readonly channel: Channel;
      readonly providerRef: string;
      readonly sentAt: Date;
      /** Why this is not provable — carried into the RequestEvent payload, not inferred later. */
      readonly note: string;
    }
  | {
      /** A carrier receipt, QTSP-anchored. The ONLY outcome that may start the statutory clock. */
      readonly kind: 'DELIVERY_PROVEN';
      readonly channel: 'postal';
      readonly providerRef: string;
      readonly sentAt: Date;
      readonly evidenceId: ProvableSendEvidenceId;
    }
  | {
      /** Not automated in Phase 0, or degraded — a human picks it up. Nothing was sent. */
      readonly kind: 'HUMAN_QUEUE';
      readonly reason: string;
    }
  | { readonly kind: 'FAILED'; readonly reason: string };

/**
 * The subset an adapter over a non-provable channel may return.
 *
 * `Extract` rather than a hand-written type on purpose: adding a variant to `SendOutcome` cannot
 * silently widen what email is allowed to claim, because the two names stay bound.
 */
export type NonProvableSendOutcome = Extract<SendOutcome, { kind: 'ACCEPTED_NON_PROVABLE' | 'FAILED' }>;

export type PostalSendOutcome = Extract<
  SendOutcome,
  { kind: 'ACCEPTED_NON_PROVABLE' | 'DELIVERY_PROVEN' | 'FAILED' }
>;

/**
 * The state-machine event an outcome maps to. Total over the union, so a new outcome variant is a
 * compile error here rather than a silently-unhandled send.
 */
export function eventFor(outcome: SendOutcome): 'provableSendConfirmed' | 'sendAccepted:nonProvable' | 'sendPermanentlyFailed' | null {
  switch (outcome.kind) {
    case 'DELIVERY_PROVEN':
      return 'provableSendConfirmed';
    case 'ACCEPTED_NON_PROVABLE':
      return 'sendAccepted:nonProvable';
    case 'FAILED':
      return 'sendPermanentlyFailed';
    case 'HUMAN_QUEUE':
      // Nothing was dispatched, so there is no send event. The request has not left READY.
      return null;
  }
}
