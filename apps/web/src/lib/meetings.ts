import { t } from '@madar/i18n';
import {
  addDays,
  calendarDateIn,
  formatJalaliDate,
  formatTime,
  meetingTimeError,
  PERSIAN_WEEKDAYS,
  toPersianDigits,
  safeMeetingLink,
  upcomingGroup,
  zonedInstant,
  type Meeting,
  type MeetingResponse,
  type MeetingSummary,
  type UpcomingGroup,
} from '@madar/shared';

/** «ساعت ۱۰:۰۰ تا ۱۱:۰۰», with the date in front when `withDate`. */
export function meetingTime(
  meeting: Pick<MeetingSummary, 'startsAt' | 'endsAt'>,
  timeZone?: string,
  withDate = false,
): string {
  const start = new Date(meeting.startsAt);
  const values = {
    start: formatTime(start, timeZone),
    end: formatTime(new Date(meeting.endsAt), timeZone),
  };
  return withDate
    ? t('meetings.timeRange', { date: formatJalaliDate(start, 'full', timeZone), ...values })
    : t('meetings.time', values);
}

export function isLive(meeting: Pick<MeetingSummary, 'startsAt' | 'endsAt'>, now = new Date()) {
  return new Date(meeting.startsAt) <= now && now < new Date(meeting.endsAt);
}

/** Upcoming meetings in today / tomorrow / this week / later, keeping their order. */
export function groupUpcoming<T extends Pick<MeetingSummary, 'startsAt'>>(
  meetings: T[],
  timeZone?: string,
  now = new Date(),
): Array<{ group: UpcomingGroup; items: T[] }> {
  const groups: Array<{ group: UpcomingGroup; items: T[] }> = [];
  for (const meeting of meetings) {
    const group = upcomingGroup(new Date(meeting.startsAt), now, timeZone);
    const last = groups.at(-1);
    if (last?.group === group) last.items.push(meeting);
    else groups.push({ group, items: [meeting] });
  }
  return groups;
}

/** HH:MM (Latin digits) of an instant in the company's time zone, for the time inputs. */
export function wallClock(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export interface MeetingFormValues {
  date: string;
  start: string;
  end: string;
  link: string;
}

/** The form's date and times as instants, or the Persian reason they cannot be. */
export function meetingInstants(
  values: MeetingFormValues,
  timeZone = 'Asia/Tehran',
): { startsAt: string; endsAt: string } | { error: string } {
  if (values.link.trim() && !safeMeetingLink(values.link))
    return { error: t('meetings.form.badLink') };
  if (!values.date || !values.start || !values.end) return { error: t('meetings.form.badTime') };
  const startsAt = zonedInstant(values.date, values.start, timeZone);
  const endsAt = zonedInstant(values.date, values.end, timeZone);
  if (meetingTimeError(startsAt, endsAt)) return { error: t('meetings.form.badTime') };
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

/** A fresh meeting: the next full hour (company time), for an hour; late evening goes to tomorrow. */
export function defaultSlot(timeZone?: string, now = new Date()): Omit<MeetingFormValues, 'link'> {
  const today = calendarDateIn(now, timeZone);
  const hour = Number(wallClock(now, timeZone).slice(0, 2)) + 1;
  if (hour > 22) return { date: addDays(today, 1), start: '09:00', end: '10:00' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: today, start: `${pad(hour)}:00`, end: `${pad(hour + 1)}:00` };
}

/** The default slot moved to a later chosen day (09:00 to 10:00); an earlier day is ignored. */
export function slotOn<T extends { date: string; start: string; end: string }>(
  slot: T,
  date?: string,
): T {
  if (!date || date <= slot.date) return slot;
  return { ...slot, date, start: '09:00', end: '10:00' };
}

/** The meeting as it looks after `memberId` replies (for the optimistic update). */
export function withResponse(
  meeting: Meeting,
  memberId: string | undefined,
  response: MeetingResponse,
): Meeting {
  const participants = meeting.participants.map((p) =>
    p.id === memberId ? { ...p, response } : p,
  );
  const count = (r: MeetingResponse) => participants.filter((p) => p.response === r).length;
  return {
    ...meeting,
    myResponse: response,
    participants,
    responses: {
      accepted: count('accepted'),
      declined: count('declined'),
      pending: count('pending'),
    },
  };
}

/** «هر هفته، شنبه‌ها، ساعت ۹:۰۰ تا ۹:۳۰». */
export function seriesText(series: NonNullable<Meeting['series']>): string {
  return t('meetings.weeklyOn', {
    weekday: PERSIAN_WEEKDAYS[series.weekday] ?? '',
    start: toPersianDigits(series.startTime),
    end: toPersianDigits(series.endTime),
  });
}
