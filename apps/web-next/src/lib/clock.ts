import type { AppStrings } from '@scraper/i18n';
import type { RequestView } from './types';

/**
 * THE TWO CLOCKS, as a type the UI cannot get wrong (port wave 2b, hazard 3).
 *
 * The pre-audit line's UI carried ONE field, `deadlineAt`, and its detail page treated
 * `AWAITING_RESPONSE` as proof that a statutory deadline was running. Porting that shape onto this
 * API would have failed silently in the worst possible direction: the page reads a field this API
 * never sends, renders "—", and a reviewer clicking through concludes "no deadline yet" — or, if
 * someone "fixes the build" by aliasing `statutoryDeadlineAt` into `deadlineAt`, a PROVISIONAL
 * scheduling hint gets rendered under the words "Gesetzliche Frist".
 *
 * So the deadline is not a nullable date here. It is a discriminated union, and the label for each
 * variant is chosen in exactly one place (`clockCopy`). A component cannot render a deadline without
 * having said which kind it is, and it cannot pick the wording itself.
 */
export type Deadline =
  | { readonly kind: 'none' }
  /** An email/web-form send. An internal scheduling hint with NO legal force (CLAUDE.md §6). */
  | { readonly kind: 'provisional'; readonly at: Date }
  /** A registered, timestamp-anchored send. The Art. 12(3) month. */
  | { readonly kind: 'statutory'; readonly at: Date };

export class ClockContractError extends Error {
  constructor(message: string) {
    super(`clock contract: ${message}`);
    this.name = 'ClockContractError';
  }
}

/**
 * Derive the deadline from the wire shape.
 *
 * Deliberately strict rather than forgiving: a response carrying a statutory deadline without
 * `clockIsProvable` means the API's own invariant broke, and the honest UI response is to fail
 * loudly here rather than to display a legal deadline we cannot justify. Displaying something
 * plausible is the failure mode this whole type exists to prevent.
 */
export function resolveDeadline(request: RequestView): Deadline {
  const { statutoryDeadlineAt, provisionalDeadlineAt, clockIsProvable } = request;

  if (statutoryDeadlineAt !== null) {
    if (!clockIsProvable) {
      throw new ClockContractError(
        `request ${request.id} carries statutoryDeadlineAt but clockIsProvable=false — a statutory ` +
          'deadline without a provable send must never be displayed (CLAUDE.md §6, ADR-012)',
      );
    }
    return { kind: 'statutory', at: new Date(statutoryDeadlineAt) };
  }
  if (provisionalDeadlineAt !== null) return { kind: 'provisional', at: new Date(provisionalDeadlineAt) };
  return { kind: 'none' };
}

export interface ClockCopy {
  readonly label: string;
  readonly note: string;
  /** Which visual treatment: the provisional clock is amber-cautionary, the statutory one is calm. */
  readonly tone: 'provisional' | 'statutory';
}

/** The ONLY mapping from clock kind to wording. Both come from @scraper/i18n, tested there. */
export function clockCopy(deadline: Deadline, s: AppStrings): ClockCopy | null {
  switch (deadline.kind) {
    case 'none':
      return null;
    case 'provisional':
      return { label: s.clock.provisionalLabel, note: s.clock.provisionalNote, tone: 'provisional' };
    case 'statutory':
      return { label: s.clock.statutoryLabel, note: s.clock.statutoryNote, tone: 'statutory' };
  }
}

export interface Remaining {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly expired: boolean;
}

/** Time left, floored at zero — a countdown that goes negative reads as a bug to a worried user. */
export function remaining(at: Date, now: Date): Remaining {
  const ms = at.getTime() - now.getTime();
  const clamped = Math.max(0, ms);
  return {
    days: Math.floor(clamped / 86_400_000),
    hours: Math.floor(clamped / 3_600_000) % 24,
    minutes: Math.floor(clamped / 60_000) % 60,
    expired: ms <= 0,
  };
}
