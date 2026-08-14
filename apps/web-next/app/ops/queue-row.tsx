import type { AppStrings } from '@scraper/i18n';
import type { OpsQueueItem } from '@/lib/types';
import { OpsActionForm } from './action-form';
import { discardComplaint, fileComplaint, resolveCase } from './actions';

/**
 * One case in the review queue.
 *
 * Two things about what this renders, both deliberate:
 *
 * **No deadline date.** The queue shows WHICH clock is running (provisional or statutory) and never
 * a date. Turning a deadline into words is `DeadlineCard`'s job and nothing else's — a rule the
 * app's structural tests enforce — because the two clocks mean different things and a screen that
 * formats one itself is one refactor away from labelling a provisional hint as a legal deadline.
 * A reviewer needs to know whether a statutory clock is running; the date lives on the case screen.
 *
 * **No subject identifiers.** The API does not send them (see `OpsQueueItem`). Nothing here would
 * have anywhere to get a name from even if someone tried.
 */
export function QueueRow({ item, s }: { item: OpsQueueItem; s: AppStrings }) {
  const drafted = item.state === 'ESCALATION_DRAFTED';
  // humanResolve:* edges exist ONLY on NEEDS_HUMAN. The queue also lists READY rows the dispatcher
  // could not send — rendering resolution buttons for those produced five silent 409s per row
  // (audit W7): a dead end dressed as a decision.
  const resolvable = item.state === 'NEEDS_HUMAN';
  // No clock tag when no clock runs: a READY row used to show the provisional tag purely because
  // `clockIsProvable` was false — there was nothing provisional about it, there was NOTHING.
  const hasClock = item.statutoryDeadlineAt != null || item.provisionalDeadlineAt != null;
  return (
    <li className="row" style={{ display: 'block', padding: '12px 0' }}>
      <b>
        <span>{s.requestTypeLabel[item.requestType]}</span>
        {hasClock ? (
          <span className={`tag ${item.clockIsProvable ? 'warn' : ''}`}>
            {item.clockIsProvable ? s.clock.statutoryLabel : s.clock.provisionalLabel}
          </span>
        ) : null}
      </b>
      <small>
        {s.ops.controllerLabel}: {item.controllerSlug} · {s.stateLabel[item.state]}
      </small>
      {item.reason ? (
        <small>
          {s.ops.reasonLabel}: {item.reason}
        </small>
      ) : null}
      {/* The venue, on the drafted row where it is about to be needed (D4). USER_RESIDENCE shows the
          rule rather than an authority: the payload carries no subject data to resolve it from, and
          inventing one would be worse than saying which question is open. */}
      {drafted && item.escalationVenue ? (
        <small>
          {s.ops.venueLabel}:{' '}
          {item.escalationVenue.kind === 'SEAT' ? item.escalationVenue.dpa : s.ops.venueUserResidence}
        </small>
      ) : null}
      <small>
        {s.ops.waitingSince}: <time dateTime={item.queuedAt}>{item.queuedAt.slice(0, 10)}</time>
      </small>

      {drafted ? (
        <div className="btnrow">
          {/* The one route to ESCALATED. It is a human act and the copy says so (ADR-008). */}
          <OpsActionForm action={fileComplaint} fields={{ id: item.id }} label={s.ops.sendComplaint} className="btn primary" />
          <OpsActionForm action={discardComplaint} fields={{ id: item.id }} label={s.ops.discardComplaint} />
        </div>
      ) : resolvable ? (
        <div className="btnrow">
          {(
            [
              ['complied', s.ops.resolveComplied],
              ['incomplete', s.ops.resolveIncomplete],
              ['refused', s.ops.resolveRefused],
              ['resend', s.ops.resolveResend],
              ['escalate', s.ops.resolveEscalate],
            ] as const
          ).map(([resolution, label]) => (
            // `escalate` is the one most likely to be refused (invariant 4b needs proven receipt),
            // and before this it refused SILENTLY — which read as "the button is broken".
            <OpsActionForm action={resolveCase} fields={{ id: item.id, resolution }} label={label} key={resolution} />
          ))}
        </div>
      ) : (
        <small>{s.ops.readyWaiting}</small>
      )}
      {drafted ? <small>{s.ops.sendNote}</small> : null}
    </li>
  );
}
