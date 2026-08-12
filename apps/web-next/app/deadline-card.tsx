import type { AppStrings } from '@scraper/i18n';
import { clockCopy, remaining, type Deadline } from '@/lib/clock';

/**
 * The ONLY component that renders a deadline.
 *
 * It takes a `Deadline` (the discriminated union), never a date — so a caller cannot hand it a
 * provisional timestamp and a statutory label. The wording and the tone both come from `clockCopy`,
 * which is the single mapping, and the copy itself is tested in @scraper/i18n for exactly this:
 * the provisional label may not borrow the statutory one's words (CLAUDE.md §6).
 */
export function DeadlineCard({ deadline, s, now }: { deadline: Deadline; s: AppStrings; now: Date }) {
  const copy = clockCopy(deadline, s);
  if (copy === null || deadline.kind === 'none') return null;
  const left = remaining(deadline.at, now);
  return (
    <div className={`deadline ${copy.tone}`}>
      <div className="lab">{copy.label}</div>
      <div className="clock">
        {left.days}
        <span> {s.clock.days} </span>
        {String(left.hours).padStart(2, '0')}:{String(left.minutes).padStart(2, '0')}
      </div>
      <p className="note">{copy.note}</p>
    </div>
  );
}
