import {
  isLeapJalaaliYear,
  isValidJalaaliDate,
  jalaaliMonthLength,
  toGregorian,
  toJalaali,
} from 'jalaali-js';

/** Default display timezone. Dates are stored in UTC and shown in the tenant's timezone. */
export const DEFAULT_TIME_ZONE = 'Asia/Tehran';

export interface JalaliDate {
  /** Jalali year, e.g. 1405 */
  jy: number;
  /** Jalali month, 1..12 */
  jm: number;
  /** Day of month, 1..31 */
  jd: number;
}

export const JALALI_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

/** Persian week starts on Saturday. Index 0 = Saturday. */
export const PERSIAN_WEEKDAYS = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
] as const;

function gregorianPartsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    gy: Number(get('year')),
    gm: Number(get('month')),
    gd: Number(get('day')),
    weekday: get('weekday'),
  };
}

const EN_WEEKDAY_TO_PERSIAN_INDEX: Record<string, number> = {
  Sat: 0,
  Sun: 1,
  Mon: 2,
  Tue: 3,
  Wed: 4,
  Thu: 5,
  Fri: 6,
};

/** The Jalali calendar date of an instant, as seen in `timeZone`. */
export function toJalali(date: Date, timeZone = DEFAULT_TIME_ZONE): JalaliDate {
  const { gy, gm, gd } = gregorianPartsIn(date, timeZone);
  return toJalaali(gy, gm, gd);
}

/** The Gregorian calendar date (YYYY-MM-DD) of an instant as seen in `timeZone`. */
export function calendarDateIn(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const { gy, gm, gd } = gregorianPartsIn(date, timeZone);
  return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
}

/** A calendar date (YYYY-MM-DD) shifted by whole days. */
export function addDays(calendarDate: string, days: number): string {
  const d = new Date(`${calendarDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Persian weekday index (0 = Saturday … 6 = Friday) of an instant in `timeZone`. */
export function persianWeekdayIndex(date: Date, timeZone = DEFAULT_TIME_ZONE): number {
  return EN_WEEKDAY_TO_PERSIAN_INDEX[gregorianPartsIn(date, timeZone).weekday] ?? 0;
}

/** Midnight UTC of the Gregorian day matching a Jalali date (a calendar date, not an instant). */
export function fromJalali({ jy, jm, jd }: JalaliDate): Date {
  if (!isValidJalaaliDate(jy, jm, jd)) {
    throw new RangeError(`Invalid Jalali date ${jy}/${jm}/${jd}`);
  }
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  return new Date(Date.UTC(gy, gm - 1, gd));
}

export function isJalaliLeapYear(jy: number): boolean {
  return isLeapJalaaliYear(jy);
}

export function jalaliMonthLength(jy: number, jm: number): number {
  return jalaaliMonthLength(jy, jm);
}

export type JalaliDateStyle = 'full' | 'long' | 'medium' | 'short';

/**
 * Formats an instant as a Persian Jalali date in `timeZone`.
 * - full:   شنبه ۲۵ مهر ۱۴۰۵
 * - long:   ۲۵ مهر ۱۴۰۵
 * - medium: ۲۵ مهر
 * - short:  ۱۴۰۵/۰۷/۲۵
 */
export function formatJalaliDate(
  date: Date,
  style: JalaliDateStyle = 'long',
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const { jy, jm, jd } = toJalali(date, timeZone);
  const fa = (n: number, pad = 0) =>
    new Intl.NumberFormat('fa-IR', { useGrouping: false, minimumIntegerDigits: pad || 1 }).format(
      n,
    );
  const month = JALALI_MONTHS[jm - 1];
  switch (style) {
    case 'full':
      return `${PERSIAN_WEEKDAYS[persianWeekdayIndex(date, timeZone)]} ${fa(jd)} ${month} ${fa(jy)}`;
    case 'long':
      return `${fa(jd)} ${month} ${fa(jy)}`;
    case 'medium':
      return `${fa(jd)} ${month}`;
    case 'short':
      return `${fa(jy)}/${fa(jm, 2)}/${fa(jd, 2)}`;
  }
}

/** Formats the time of day (24h) in `timeZone`, e.g. ۱۳:۳۰. */
export function formatTime(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** Human relative time in Persian, e.g. «۳ ساعت پیش»، «فردا»، «همین الان». */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('fa', { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return rtf.format(0, 'second');
}

/* ---------- Calendar dates (YYYY-MM-DD, no time zone): due dates, plan days ---------- */

function parseCalendarDate(date: string): { gy: number; gm: number; gd: number } {
  const [gy, gm, gd] = date.split('-').map(Number) as [number, number, number];
  return { gy, gm, gd };
}

/** The Jalali parts of a calendar date. */
export function jalaliOfCalendarDate(date: string): JalaliDate {
  const { gy, gm, gd } = parseCalendarDate(date);
  return toJalaali(gy, gm, gd);
}

/** The calendar date (YYYY-MM-DD) of a Jalali date. */
export function calendarDateOfJalali(jalali: JalaliDate): string {
  return fromJalali(jalali).toISOString().slice(0, 10);
}

/** Persian weekday index (0 = Saturday … 6 = Friday) of a calendar date. */
export function persianWeekdayOfCalendarDate(date: string): number {
  // getUTCDay: 0 = Sunday … 6 = Saturday.
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7;
}

/** Formats a calendar date (styles as in `formatJalaliDate`). */
export function formatCalendarDate(date: string, style: JalaliDateStyle = 'medium'): string {
  return formatJalaliDate(new Date(`${date}T12:00:00Z`), style, 'UTC');
}

/**
 * The weeks of a Jalali month for a calendar grid: rows of 7 cells starting on Saturday,
 * each a calendar date or null for padding.
 */
export function jalaliMonthGrid(jy: number, jm: number): Array<Array<string | null>> {
  const first = calendarDateOfJalali({ jy, jm, jd: 1 });
  const cells: Array<string | null> = Array.from(
    { length: persianWeekdayOfCalendarDate(first) },
    () => null,
  );
  for (let d = 0; d < jalaliMonthLength(jy, jm); d++) cells.push(addDays(first, d));
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Moves a Jalali month by `delta` months. */
export function shiftJalaliMonth(
  jy: number,
  jm: number,
  delta: number,
): { jy: number; jm: number } {
  const index = jy * 12 + (jm - 1) + delta;
  return { jy: Math.floor(index / 12), jm: (index % 12) + 1 };
}

export type DueStatus = 'overdue' | 'today' | 'tomorrow' | 'upcoming';

/** How a due date relates to today (both calendar dates in the tenant time zone). */
export function dueStatus(dueOn: string, today: string): DueStatus {
  if (dueOn < today) return 'overdue';
  if (dueOn === today) return 'today';
  if (dueOn === addDays(today, 1)) return 'tomorrow';
  return 'upcoming';
}
