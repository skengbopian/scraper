/**
 * The Art. 12(3) clock as a CALENDAR period — Regulation (EEC, Euratom) No 1182/71 semantics, the
 * rule EU-law deadlines are read under. EDPB Guidelines 01/2022 §54 applies exactly this to
 * Art. 12(3): a request received 4 March is due by the end of 4 April.
 *
 *   - the period ends with the expiry of the day in the last month with the same number as the
 *     trigger day (Art. 3(2)(c));
 *   - if the last month has no such day, it ends with the last day of that month
 *     (31 Jan + 1 month → end of 28/29 Feb);
 *   - if the final day is a Saturday, Sunday or public holiday, the period runs to the end of the
 *     next working day (Art. 3(4)).
 *
 * The previous arithmetic (`deadlineDays × 86_400_000` ms) fired up to a full day EARLY over
 * 31-day months — an escalation draft asserting the month ran out in silence while it legally had
 * a day left. This function's contract is the conservative direction: the computed instant is
 * never before the true statutory end.
 *
 * Days are Europe/Berlin days: the controller answers on German civil time, and "end of the day"
 * is theirs, not UTC's.
 *
 * Holidays applied: the bundesweit set (incl. the Easter-derived movable feasts). Land-specific
 * holidays (Fronleichnam, Reformationstag, …) are NOT — which Land applies is a property of the
 * controller's seat. Omitting one can make the computed end at most one working day early
 * relative to that Land, and the silence escalation this clock gates is drafted, human-reviewed,
 * and never auto-sent. TODO(counsel): decide whether the seat Land's holiday set should extend a
 * controller's deadline, and source the per-Land table if so.
 */

const BERLIN = 'Europe/Berlin';

interface CalendarDay {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

const PARTS_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BERLIN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

function berlinParts(at: Date): CalendarDay & { hh: number } {
  const parts = Object.fromEntries(PARTS_FMT.formatToParts(at).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hh: Number(parts.hour) };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Weekday of a calendar date is a property of the date itself — no timezone involved. 0 = Sunday. */
function weekday(day: CalendarDay): number {
  return new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
}

function addDays(day: CalendarDay, n: number): CalendarDay {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function sameDay(a: CalendarDay, b: CalendarDay): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** Anonymous Gregorian computus. */
function easterSunday(y: number): CalendarDay {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y, m: month, d: day };
}

/** Bundesweite Feiertage for the given year — Land-specific ones deliberately excluded (header). */
function nationwideHolidays(y: number): readonly CalendarDay[] {
  const easter = easterSunday(y);
  return [
    { y, m: 1, d: 1 }, // Neujahr
    addDays(easter, -2), // Karfreitag
    addDays(easter, 1), // Ostermontag
    { y, m: 5, d: 1 }, // Tag der Arbeit
    addDays(easter, 39), // Christi Himmelfahrt
    addDays(easter, 50), // Pfingstmontag
    { y, m: 10, d: 3 }, // Tag der Deutschen Einheit
    { y, m: 12, d: 25 }, // 1. Weihnachtstag
    { y, m: 12, d: 26 }, // 2. Weihnachtstag
  ];
}

function isNonWorkingDay(day: CalendarDay): boolean {
  const wd = weekday(day);
  if (wd === 0 || wd === 6) return true;
  return nationwideHolidays(day.y).some((h) => sameDay(h, day));
}

/** The UTC instant at which the given Europe/Berlin calendar day begins (00:00 Berlin time). */
function berlinMidnightUtc(day: CalendarDay): Date {
  // Berlin is UTC+1 (CET) or UTC+2 (CEST); DST switches at 02:00/03:00 local, so midnight itself
  // always exists — exactly one of the two candidates renders as 00:00 on the right date.
  for (const offsetMinutes of [120, 60]) {
    const candidate = new Date(Date.UTC(day.y, day.m - 1, day.d) - offsetMinutes * 60_000);
    const p = berlinParts(candidate);
    if (p.y === day.y && p.m === day.m && p.d === day.d && p.hh === 0) return candidate;
  }
  throw new Error(`unresolvable Europe/Berlin midnight for ${day.y}-${day.m}-${day.d}`);
}

/**
 * The instant the Art. 12(3) period expires: end (= next Berlin midnight) of the same-numbered day
 * `months` calendar months after `from`, clamped to month length, extended over non-working days.
 */
export function statutoryDeadlineAt(from: Date, months = 1): Date {
  const start = berlinParts(from);
  const monthIndex = start.m - 1 + months;
  const y = start.y + Math.floor(monthIndex / 12);
  const m = (monthIndex % 12) + 1;
  let day: CalendarDay = { y, m, d: Math.min(start.d, daysInMonth(y, m)) };
  while (isNonWorkingDay(day)) day = addDays(day, 1);
  // "Expiry of the last hour" of the final day — the next Berlin midnight.
  return berlinMidnightUtc(addDays(day, 1));
}
