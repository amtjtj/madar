/**
 * Meetings (plan phase-2-step-13a, ADR 0023): rules shared by the API and the web.
 */
import {
  addDays,
  calendarDateIn,
  DEFAULT_TIME_ZONE,
  persianWeekdayIndex,
  persianWeekdayOfCalendarDate,
} from './locale/jalali.js';

export const MEETING_TYPES = ['regular', 'okr_review', 'one_on_one'] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_TITLE_MAX = 200;
export const MEETING_AGENDA_MAX = 10_000;
export const MEETING_PARTICIPANTS_MAX = 100;
export const MEETING_MAX_HOURS = 24;
export const DECISION_TEXT_MAX = 500;
export const MINUTES_FILES_MAX = 10;

/** Why a start and end cannot be a meeting, or null when they can. */
export function meetingTimeError(
  startsAt: Date,
  endsAt: Date,
): 'ends_before_start' | 'too_long' | null {
  const ms = endsAt.getTime() - startsAt.getTime();
  if (!(ms > 0)) return 'ends_before_start';
  if (ms > MEETING_MAX_HOURS * 3_600_000) return 'too_long';
  return null;
}

/** A link people may open from a meeting: http or https only, else null. */
export function safeMeetingLink(value: string): string | null {
  const link = value.trim();
  return /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(link) ? link : null;
}

export const UPCOMING_GROUPS = ['today', 'tomorrow', 'week', 'later'] as const;
export type UpcomingGroup = (typeof UPCOMING_GROUPS)[number];

/**
 * Where an upcoming meeting goes in the list: today, tomorrow, the rest of this week (the
 * Persian week ends on Friday) or later. Dates are in the company's time zone.
 */
export function upcomingGroup(
  startsAt: Date,
  now: Date = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): UpcomingGroup {
  const today = calendarDateIn(now, timeZone);
  const day = calendarDateIn(startsAt, timeZone);
  if (day <= today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  const weekEnd = addDays(today, 6 - persianWeekdayIndex(now, timeZone));
  return day <= weekEnd ? 'week' : 'later';
}

/** The first line of a decision, cut to a task title. */
export function taskTitleFromDecision(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/** Attendance replies (plan phase-2-step-13b); the organizer is always «accepted». */
export const MEETING_RESPONSES = ['pending', 'accepted', 'declined'] as const;
export type MeetingResponse = (typeof MEETING_RESPONSES)[number];

/** Weekly meetings are made this many weeks ahead (at creation and every night). */
export const SERIES_HORIZON_WEEKS = 8;
/** «جلسه تا ۱۰ دقیقه دیگر». */
export const MEETING_REMINDER_MINUTES = 10;

/**
 * The days a weekly series meets between `from` and `to` (inclusive, YYYY-MM-DD): its weekday
 * (0 = Saturday), from its first day, up to its last day, skipping the company's holidays.
 */
export function seriesDates(
  series: { startsOn: string; weekday: number; untilOn: string | null },
  from: string,
  to: string,
  holidays: readonly string[] = [],
): string[] {
  let day = from > series.startsOn ? from : series.startsOn;
  const last = series.untilOn && series.untilOn < to ? series.untilOn : to;
  const shift = (series.weekday - persianWeekdayOfCalendarDate(day) + 7) % 7;
  day = addDays(day, shift);
  const off = new Set(holidays);
  const dates: string[] = [];
  for (; day <= last; day = addDays(day, 7)) {
    if (!off.has(day)) dates.push(day);
  }
  return dates;
}

/** HH:MM (Latin digits) of an instant in `timeZone`. */
export function wallClockIn(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}
