import type { AppStrings } from '@scraper/i18n';
import type { OpsQueueItem } from '@/lib/types';
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
  return (
    <li className="row" style={{ display: 'block', padding: '12px 0' }}>
      <b>
        <span>{s.requestTypeLabel[item.requestType]}</span>
        <span className={`tag ${item.clockIsProvable ? 'warn' : ''}`}>
          {item.clockIsProvable ? s.clock.statutoryLabel : s.clock.provisionalLabel}
        </span>
      </b>
      <small>
        {s.ops.controllerLabel}: {item.controllerSlug} · {s.stateLabel[item.state]}
      </small>
      {item.reason ? (
        <small>
          {s.ops.reasonLabel}: {item.reason}
        </small>
      ) : null}
      <small>
        {s.ops.waitingSince}: <time dateTime={item.queuedAt}>{item.queuedAt.slice(0, 10)}</time>
      </small>

      {drafted ? (
        <div className="btnrow">
          {/* The one route to ESCALATED. It is a human act and the copy says so (ADR-008). */}
          <form action={fileComplaint}>
            <input type="hidden" name="id" value={item.id} />
            <button className="btn primary" type="submit">{s.ops.sendComplaint}</button>
          </form>
          <form action={discardComplaint}>
            <input type="hidden" name="id" value={item.id} />
            <button className="btn" type="submit">{s.ops.discardComplaint}</button>
          </form>
        </div>
      ) : (
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
            <form action={resolveCase} key={resolution}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="resolution" value={resolution} />
              <button className="btn" type="submit">{label}</button>
            </form>
          ))}
        </div>
      )}
      {drafted ? <small>{s.ops.sendNote}</small> : null}
    </li>
  );
}
