import type { Mailer } from '@scraper/core';
import type { NonProvableSendOutcome } from './types.js';

/**
 * The email channel. Only the Controller Gateway may call it.
 *
 * RE-DERIVED, not ported. The pre-audit line's version is the root of the C1 violation:
 *
 *     // apps/worker/src/channels/email.ts:18-22 (repo A)
 *     // TODO(safety): "provable" for email requires provider acceptance PLUS a
 *     // verified DKIM-aligned send domain ... hardcoded true for Phase-0 dev only
 *     return { providerRef: messageId, provable: true };
 *
 * The comment names the defect and ships it anyway, which is what a boolean invites. Here the return
 * type is `NonProvableSendOutcome`, which has no provable variant at all — so this function cannot
 * start the statutory clock even if someone later "fixes" the DKIM check and decides that counts.
 *
 * It does not count. A DKIM-aligned accept proves the message left our infrastructure with an intact
 * signature. It says nothing about receipt: the recipient MX can defer, bounce, silently discard, or
 * file it in a mailbox nobody reads. Art. 12(3) runs from the controller's receipt of the request,
 * so email sets `provisionalDeadlineAt` and nothing else (CLAUDE.md §6, ADR-012).
 *
 * `accepted` and `dkimAligned` still matter — they are the difference between a send worth waiting
 * on and one that failed — so they decide ACCEPTED_NON_PROVABLE vs FAILED, never the clock.
 */
export async function sendLegalRequestEmail(
  mailer: Mailer,
  msg: { to: string; subject: string; text: string },
  now: Date,
): Promise<NonProvableSendOutcome> {
  let result: Awaited<ReturnType<Mailer['send']>>;
  try {
    result = await mailer.send(msg);
  } catch (e) {
    return { kind: 'FAILED', reason: `mailer threw: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!result.accepted) {
    return { kind: 'FAILED', reason: `mail provider did not accept the message (${result.messageId || 'no id'})` };
  }
  if (!result.dkimAligned) {
    // Not a clock question — a deliverability one. An unaligned send is far likelier to be filed as
    // spam, and a legal request the controller never reads burns a month and books a false
    // non-compliance statistic against them. Fail closed to ops rather than start a chase clock on it.
    return {
      kind: 'FAILED',
      reason:
        'the send domain is not DKIM-aligned. This does not make the send unprovable (email never ' +
        'is) — it makes it likely to be filtered, which would burn a provisional month and record a ' +
        'silence that was our fault.',
    };
  }

  return {
    kind: 'ACCEPTED_NON_PROVABLE',
    channel: 'email',
    providerRef: result.messageId,
    sentAt: now,
    note: 'email accepted and DKIM-aligned: proves WE SENT, not that they received (CLAUDE.md §6)',
  };
}
