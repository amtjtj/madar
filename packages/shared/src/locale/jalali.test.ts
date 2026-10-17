import { describe, expect, it } from 'vitest';

import {
  formatJalaliDate,
  formatRelativeTime,
  formatTime,
  fromJalali,
  isJalaliLeapYear,
  jalaliMonthLength,
  persianWeekdayIndex,
  toJalali,
} from './jalali.js';

// 2026-10-17 10:00 UTC = Saturday 25 Mehr 1405, 13:30 in Tehran
const instant = new Date('2026-10-17T10:00:00Z');

describe('jalali', () => {
  it('converts an instant to a Jalali date in Tehran', () => {
    expect(toJalali(instant)).toEqual({ jy: 1405, jm: 7, jd: 25 });
  });

  it('respects the timezone at day boundaries', () => {
    // 21:00 UTC on 17 Oct is already 18 Oct (26 Mehr) in Tehran (UTC+3:30)
    const lateUtc = new Date('2026-10-17T21:00:00Z');
    expect(toJalali(lateUtc)).toEqual({ jy: 1405, jm: 7, jd: 26 });
    expect(toJalali(lateUtc, 'UTC')).toEqual({ jy: 1405, jm: 7, jd: 25 });
  });

  it('converts a Jalali date back to the Gregorian calendar day', () => {
    expect(fromJalali({ jy: 1405, jm: 1, jd: 1 }).toISOString().slice(0, 10)).toBe('2026-03-21');
    expect(() => fromJalali({ jy: 1405, jm: 12, jd: 31 })).toThrow(RangeError);
  });

  it('knows leap years and month lengths', () => {
    expect(isJalaliLeapYear(1403)).toBe(true);
    expect(isJalaliLeapYear(1405)).toBe(false);
    expect(jalaliMonthLength(1405, 1)).toBe(31);
    expect(jalaliMonthLength(1405, 7)).toBe(30);
  });

  it('uses Saturday as the first weekday', () => {
    expect(persianWeekdayIndex(instant)).toBe(0);
  });

  it('formats dates in every style', () => {
    expect(formatJalaliDate(instant, 'full')).toBe('شنبه ۲۵ مهر ۱۴۰۵');
    expect(formatJalaliDate(instant, 'long')).toBe('۲۵ مهر ۱۴۰۵');
    expect(formatJalaliDate(instant, 'medium')).toBe('۲۵ مهر');
    expect(formatJalaliDate(instant, 'short')).toBe('۱۴۰۵/۰۷/۲۵');
  });

  it('formats the time of day in Tehran', () => {
    expect(formatTime(instant)).toBe('۱۳:۳۰');
  });

  it('formats relative time', () => {
    const now = new Date('2026-10-17T10:00:00Z');
    expect(formatRelativeTime(new Date('2026-10-17T07:00:00Z'), now)).toBe('۳ ساعت پیش');
    expect(formatRelativeTime(new Date('2026-10-18T10:00:00Z'), now)).toBe('فردا');
    expect(formatRelativeTime(now, now)).toBe('اکنون');
  });
});
