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
      /**
       * When the carrier's receipt says it was DELIVERED — not when we asked. Art. 12(3) runs from
       * receipt of the request, so this is what the calendar month is measured from.
       */
      readonly deliveredAt: Date;
      readonly evidenceId: ProvableSendEvidenceId;
    }
  | {
      /**
       * A registered letter is with the carrier (Einlieferung) and the delivery receipt
       * (Auslieferungsbeleg) has not come back. This is what a HONEST postal adapter returns for
       * essentially every real registered send — and before audit F3a there was no such variant, so
       * it had to be reported as ACCEPTED_NON_PROVABLE and the request took the provisional clock
       * with no way ever to be upgraded. The Art. 12(3) clock was therefore unreachable in
       * production. This variant maps to `registeredSendLodged` and parks the request in
       * AWAITING_DELIVERY_PROOF with NO clock of any kind until the receipt arrives.
       */
      readonly kind: 'REGISTERED_LODGED';
      readonly channel: 'postal';
      readonly providerRef: string;
      readonly sentAt: Date;
      /** Why no proof yet — carried into the RequestEvent payload, not inferred later. */
      readonly note: string;
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
  { kind: 'ACCEPTED_NON_PROVABLE' | 'DELIVERY_PROVEN' | 'REGISTERED_LODGED' | 'FAILED' }
>;

/**
 * The state-machine event an outcome maps to. Total over the union, so a new outcome variant is a
 * compile error here rather than a silently-unhandled send.
 *
 * Note that the mapping stays one-way and structural: the OUTCOME's type decides which clock (if
 * any) starts, and no adapter can widen its own return type to claim a better one. `REGISTERED_LODGED`
 * is reachable only from the postal adapter, and `NonProvableSendOutcome` — what the email adapter
 * returns — still excludes it, so email keeps mapping to `sendAccepted:nonProvable` and nothing else.
 */
export function eventFor(
  outcome: SendOutcome,
): 'provableSendConfirmed' | 'registeredSendLodged' | 'sendAccepted:nonProvable' | 'sendPermanentlyFailed' | null {
  switch (outcome.kind) {
    case 'DELIVERY_PROVEN':
      return 'provableSendConfirmed';
    case 'REGISTERED_LODGED':
      return 'registeredSendLodged';
    case 'ACCEPTED_NON_PROVABLE':
      return 'sendAccepted:nonProvable';
    case 'FAILED':
      return 'sendPermanentlyFailed';
    case 'HUMAN_QUEUE':
      // Nothing was dispatched, so there is no send event. The request has not left READY.
      return null;
  }
}
