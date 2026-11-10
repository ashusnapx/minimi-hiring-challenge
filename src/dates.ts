import * as chrono from 'chrono-node';

/** Inclusive calendar-day range, YYYY-MM-DD in the user's timezone. */
export type DayRange = { from: string; to: string };
/** A date phrase found in the user's message. More than one candidate means it is genuinely ambiguous. */
export type DateRef = { phrase: string; candidates: DayRange[] };

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MS = 86_400_000;

// Calendar maths on YYYY-MM-DD strings via UTC midnight: no timezone or DST can shift a day.
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');
const min = (a: string, b: string) => (a < b ? a : b);
const single = (day: string): DayRange => ({ from: day, to: day });
const weekdayOf = (day: string) => new Date(utc(day)).getUTCDay();
export const addDays = (day: string, n: number) => fmt(utc(day) + n * DAY_MS);

/** Calendar day of an instant in an IANA timezone, e.g. "2026-11-11". */
export function localDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** "14:02" in the user's timezone. */
export function localTime(at: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}

/** "Wednesday 11 November 2026" */
export function longDate(day: string): string {
  return new Date(utc(day)).toLocaleDateString('en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).replace(',', '');
}

export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds date phrases in a message and turns them into past day ranges, relative to `today`.
 * Done in code, not by the model: date maths is where models quietly go wrong.
 */
export function resolveDates(text: string, today: string): DateRef[] {
  const [y, m, d] = today.split('-').map(Number);
  const ref = new Date(y, m - 1, d, 12); // chrono reads local fields; noon keeps DST off the date
  const refs: DateRef[] = [];
  for (const r of chrono.parse(text, ref)) {
    const candidates = rangesFor(r, today);
    if (candidates) refs.push({ phrase: r.text, candidates });
  }
  return refs;
}

function rangesFor(r: chrono.ParsedResult, today: string): DayRange[] | null {
  const phrase = r.text.toLowerCase();
  const s = r.start;
  const day = `${s.get('year')}-${pad(s.get('month')!)}-${pad(s.get('day')!)}`;
  const back = /\b(last|past|previous)\b/.test(phrase);
  const thisMonday = addDays(today, -((weekdayOf(today) + 6) % 7));

  const wd = WEEKDAYS.findIndex((w) => phrase.includes(w));
  if (wd >= 0 && !s.isCertain('day')) {
    // A bare weekday is the most recent one. "Last Tuesday" said on a Wednesday can mean yesterday
    // or the week before, so both are kept and memory decides which one has a conversation.
    const recent = addDays(today, -((weekdayOf(today) - wd + 7) % 7 || 7));
    return back ? [single(recent), single(addDays(recent, -7))] : [single(recent)];
  }
  if (/\bweeks?\b/.test(phrase)) {
    if (/\bthis week\b/.test(phrase)) return [{ from: thisMonday, to: today }];
    if (back) return [{ from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) }];
    return [{ from: addDays(day, -3), to: min(addDays(day, 3), today) }]; // "2 weeks ago" is fuzzy
  }
  if (/\bmonths?\b/.test(phrase)) {
    const lastOfMonth = fmt(Date.UTC(s.get('year')!, s.get('month')!, 0));
    return [{ from: `${day.slice(0, 8)}01`, to: min(lastOfMonth, today) }];
  }

  let from = day;
  if (from > today) {
    if (s.isCertain('year')) return null; // a real future date is not a memory reference
    from = `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`; // "3 December" asked in November = last year
  }
  const e = r.end;
  const to = e ? `${e.get('year')}-${pad(e.get('month')!)}-${pad(e.get('day')!)}` : from;
  return [{ from, to: min(to < from ? from : to, today) }];
}
