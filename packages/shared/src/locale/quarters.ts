import { calendarDateOfJalali, jalaliMonthLength, jalaliOfCalendarDate } from './jalali.js';

/**
 * Goal periods are Jalali seasons: 1 spring (Farvardin–Khordad), 2 summer (Tir–Shahrivar),
 * 3 autumn (Mehr–Azar), 4 winter (Dey–Esfand). The UI names them from i18n (`goals.seasons.*`).
 */
export interface JalaliQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  /** First and last calendar day (YYYY-MM-DD), inclusive. */
  startOn: string;
  endOn: string;
}

export function jalaliQuarter(year: number, quarter: 1 | 2 | 3 | 4): JalaliQuarter {
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  return {
    year,
    quarter,
    startOn: calendarDateOfJalali({ jy: year, jm: firstMonth, jd: 1 }),
    endOn: calendarDateOfJalali({
      jy: year,
      jm: lastMonth,
      jd: jalaliMonthLength(year, lastMonth),
    }),
  };
}

/** The season a calendar date (YYYY-MM-DD) falls in. */
export function jalaliQuarterOf(date: string): JalaliQuarter {
  const { jy, jm } = jalaliOfCalendarDate(date);
  return jalaliQuarter(jy, (Math.floor((jm - 1) / 3) + 1) as 1 | 2 | 3 | 4);
}

/** The season after the given one. */
export function nextJalaliQuarter(q: Pick<JalaliQuarter, 'year' | 'quarter'>): JalaliQuarter {
  return q.quarter === 4
    ? jalaliQuarter(q.year + 1, 1)
    : jalaliQuarter(q.year, (q.quarter + 1) as 1 | 2 | 3 | 4);
}
