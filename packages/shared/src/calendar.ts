/**
 * The personal calendar (plan phase-2-step-14a, ADR 0024): ranges and day helpers shared by the API
 * and the web. Days are YYYY-MM-DD in the company's time zone.
 */
import {
  addDays,
  calendarDateOfJalali,
  jalaliMonthLength,
  persianWeekdayOfCalendarDate,
} from './locale/jalali.js';

export const CALENDAR_LAYERS = [
  'tasks',
  'plan',
  'meetings',
  'projects',
  'periods',
  'holidays',
  /** Approved leaves (plan phase-3-step-17b). */
  'leaves',
] as const;
export type CalendarLayer = (typeof CALENDAR_LAYERS)[number];

/** A month grid with its edge weeks is at most six weeks. */
export const CALENDAR_MAX_DAYS = 42;
/** How far «روزهای بعد» moves the agenda. */
export const AGENDA_STEP_DAYS = 14;
/** Items per layer in one range before the answer says it was cut. */
export const CALENDAR_LAYER_MAX = 500;

/** Days from `from` to `to`, both included. */
export function daysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The whole weeks (Saturday to Friday) a Jalali month spans. */
export function monthRange(jy: number, jm: number): { from: string; to: string } {
  const first = calendarDateOfJalali({ jy, jm, jd: 1 });
  const last = addDays(first, jalaliMonthLength(jy, jm) - 1);
  return {
    from: addDays(first, -persianWeekdayOfCalendarDate(first)),
    to: addDays(last, 6 - persianWeekdayOfCalendarDate(last)),
  };
}

/** The Saturday-to-Friday week holding `date`. */
export function weekRange(date: string): { from: string; to: string } {
  const from = addDays(date, -persianWeekdayOfCalendarDate(date));
  return { from, to: addDays(from, 6) };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Whole hours a time grid shows (plan phase-2-step-14b): the company's working hours on the shown
 * days, widened to hold every timed event (minutes from local midnight). 08–18 when nothing is known.
 */
export function timeGridSpan(
  hours: Array<{ start: string; end: string } | null>,
  events: Array<{ start: number; end: number }> = [],
): { startHour: number; endHour: number } {
  const starts = [
    ...hours.flatMap((h) => (h ? [minutesOf(h.start)] : [])),
    ...events.map((e) => e.start),
  ];
  const ends = [
    ...hours.flatMap((h) => (h ? [minutesOf(h.end)] : [])),
    ...events.map((e) => e.end),
  ];
  if (starts.length === 0) return { startHour: 8, endHour: 18 };
  const startHour = Math.max(0, Math.floor(Math.min(...starts) / 60));
  const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(Math.max(...ends) / 60)));
  return { startHour, endHour };
}

/**
 * Side-by-side columns for overlapping timed events: each event gets a column and the column count
 * of its overlap group, so a grid can place it at `column / columns` of the day's width.
 */
export function layoutOverlaps<T extends { id: string; start: number; end: number }>(
  events: T[],
): Map<string, { column: number; columns: number }> {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map<string, { column: number; columns: number }>();
  let group: Array<{ id: string; column: number }> = [];
  let columnEnds: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    for (const g of group) result.set(g.id, { column: g.column, columns: columnEnds.length });
    group = [];
    columnEnds = [];
  };
  for (const event of sorted) {
    if (event.start >= groupEnd) close();
    // An event never shorter than a sliver, so zero-length meetings still take room.
    const end = Math.max(event.end, event.start + 1);
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= event.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }
    group.push({ id: event.id, column });
    groupEnd = Math.max(groupEnd, end);
  }
  close();
  return result;
}
