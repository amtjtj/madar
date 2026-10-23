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
