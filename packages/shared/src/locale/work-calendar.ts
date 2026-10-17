import { addDays, DEFAULT_TIME_ZONE } from './jalali.js';

/** Working hours of one weekday (local "HH:MM"), or null when the day is off. */
export type DayHours = { start: string; end: string } | null;

export interface WorkCalendar {
  /** Seven entries, Saturday first. */
  weeklyHours: DayHours[];
  /** Extra days off (YYYY-MM-DD). */
  holidays: string[];
  /** Working days past due before department managers are told; 0 turns it off. */
  overdueEscalationDays: number;
}

/** Product default (docs/pilot-assumptions.md §2): Sat–Wed 9–18, Thursday half day, Friday off. */
export const DEFAULT_WORK_CALENDAR: WorkCalendar = {
  weeklyHours: [
    { start: '09:00', end: '18:00' },
    { start: '09:00', end: '18:00' },
    { start: '09:00', end: '18:00' },
    { start: '09:00', end: '18:00' },
    { start: '09:00', end: '18:00' },
    { start: '09:00', end: '13:00' },
    null,
  ],
  holidays: [],
  overdueEscalationDays: 2,
};

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

interface LocalParts {
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Saturday … 6 = Friday. */
  weekday: number;
}

const WEEKDAY: Record<string, number> = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    weekday: WEEKDAY[get('weekday')] ?? 0,
  };
}

/** The instant of a local wall-clock time in `timeZone` (handles offset changes). */
export function zonedInstant(date: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(y, mo - 1, d) + toMinutes(hhmm) * 60_000;
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const [py, pm, pd] = p.date.split('-').map(Number) as [number, number, number];
    const seen = Date.UTC(py, pm - 1, pd) + p.minutes * 60_000;
    guess += target - seen;
  }
  return new Date(guess);
}

const weekdayOf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7;

/** Working hours of a calendar date, or null on a day off. */
export function hoursOn(calendar: WorkCalendar, date: string): DayHours {
  if (calendar.holidays.includes(date)) return null;
  return calendar.weeklyHours[weekdayOf(date)] ?? null;
}

export function isWorkingDay(calendar: WorkCalendar, date: string): boolean {
  return hoursOn(calendar, date) !== null;
}

export function isWorkingTime(
  calendar: WorkCalendar,
  instant: Date,
  timeZone = DEFAULT_TIME_ZONE,
): boolean {
  const local = localParts(instant, timeZone);
  const hours = hoursOn(calendar, local.date);
  return (
    hours !== null &&
    local.minutes >= toMinutes(hours.start) &&
    local.minutes < toMinutes(hours.end)
  );
}

/** `instant` itself during working hours, otherwise the start of the next working period. */
export function nextWorkingStart(
  calendar: WorkCalendar,
  instant: Date,
  timeZone = DEFAULT_TIME_ZONE,
): Date {
  if (isWorkingTime(calendar, instant, timeZone)) return instant;
  const local = localParts(instant, timeZone);
  for (let offset = 0; offset < 366; offset++) {
    const date = addDays(local.date, offset);
    const hours = hoursOn(calendar, date);
    if (!hours) continue;
    if (offset === 0 && local.minutes >= toMinutes(hours.start)) continue;
    return zonedInstant(date, hours.start, timeZone);
  }
  return instant; // a calendar without any working day: never hold notifications back
}

/**
 * When a notification may interrupt the member: now during working hours or if they opted in to
 * off-hours notifications, otherwise the start of the next working period.
 */
export function deliverAfter(
  calendar: WorkCalendar,
  now: Date,
  options: { timeZone?: string; offHours?: boolean } = {},
): Date {
  return options.offHours ? now : nextWorkingStart(calendar, now, options.timeZone);
}

/** Working days strictly after `from` up to and including `to` (both YYYY-MM-DD). */
export function workingDaysBetween(calendar: WorkCalendar, from: string, to: string): number {
  let count = 0;
  for (let date = addDays(from, 1); date <= to; date = addDays(date, 1)) {
    if (isWorkingDay(calendar, date)) count++;
  }
  return count;
}

/** Whether a working day has started in `timeZone` (used by scheduled reminders). */
export function workdayStarted(
  calendar: WorkCalendar,
  instant: Date,
  timeZone = DEFAULT_TIME_ZONE,
): { date: string; started: boolean } {
  const local = localParts(instant, timeZone);
  const hours = hoursOn(calendar, local.date);
  return { date: local.date, started: hours !== null && local.minutes >= toMinutes(hours.start) };
}
