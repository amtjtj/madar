import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORK_CALENDAR as cal,
  deliverAfter,
  isWorkingTime,
  nextWorkingStart,
  workdayStarted,
  workingDaysBetween,
  workingDayAfter,
  zonedInstant,
} from './work-calendar.js';

// Tehran is UTC+03:30. 2026-10-17 is a Saturday (25 Mehr 1405).
const tehran = (date: string, time: string) => zonedInstant(date, time, 'Asia/Tehran');

describe('work calendar', () => {
  it('converts Tehran wall-clock times to instants', () => {
    expect(tehran('2026-10-17', '09:00').toISOString()).toBe('2026-10-17T05:30:00.000Z');
  });

  it('knows working hours, the Thursday half day and Friday', () => {
    expect(isWorkingTime(cal, tehran('2026-10-21', '17:59'))).toBe(true); // Wednesday
    expect(isWorkingTime(cal, tehran('2026-10-21', '18:00'))).toBe(false);
    expect(isWorkingTime(cal, tehran('2026-10-22', '12:30'))).toBe(true); // Thursday
    expect(isWorkingTime(cal, tehran('2026-10-22', '13:30'))).toBe(false);
    expect(isWorkingTime(cal, tehran('2026-10-23', '10:00'))).toBe(false); // Friday
    expect(isWorkingTime(cal, tehran('2026-10-17', '08:59'))).toBe(false);
  });

  it('holds notifications until the next working period', () => {
    // Thursday 20:00 → Saturday 09:00
    expect(nextWorkingStart(cal, tehran('2026-10-22', '20:00'))).toEqual(
      tehran('2026-10-24', '09:00'),
    );
    // Early morning → same day 09:00
    expect(nextWorkingStart(cal, tehran('2026-10-19', '06:10'))).toEqual(
      tehran('2026-10-19', '09:00'),
    );
    // During working hours → now
    const now = tehran('2026-10-19', '11:00');
    expect(deliverAfter(cal, now)).toEqual(now);
    // Off-hours opt-in → now
    const night = tehran('2026-10-19', '23:00');
    expect(deliverAfter(cal, night, { offHours: true })).toEqual(night);
  });

  it('skips holidays', () => {
    const withHoliday = { ...cal, holidays: ['2026-10-24'] };
    expect(nextWorkingStart(withHoliday, tehran('2026-10-22', '20:00'))).toEqual(
      tehran('2026-10-25', '09:00'),
    );
    expect(isWorkingTime(withHoliday, tehran('2026-10-24', '10:00'))).toBe(false);
  });

  it('counts working days for manager escalation', () => {
    // Due Wednesday; Thursday (half day) counts, Friday does not, Saturday does.
    expect(workingDaysBetween(cal, '2026-10-21', '2026-10-22')).toBe(1);
    expect(workingDaysBetween(cal, '2026-10-21', '2026-10-24')).toBe(2);
    expect(workingDaysBetween(cal, '2026-10-21', '2026-10-21')).toBe(0);
  });

  it('tells whether the working day has started', () => {
    expect(workdayStarted(cal, tehran('2026-10-19', '08:00'))).toEqual({
      date: '2026-10-19',
      started: false,
    });
    expect(workdayStarted(cal, tehran('2026-10-19', '09:05'))).toEqual({
      date: '2026-10-19',
      started: true,
    });
    expect(workdayStarted(cal, tehran('2026-10-23', '10:00')).started).toBe(false);
  });
});

describe('working day after', () => {
  it('skips Fridays and holidays, never goes back', () => {
    const withHoliday = { ...cal, holidays: ['2026-10-24'] };
    // 2026-10-22 is a Thursday: two days later is Saturday the 24th, a holiday here.
    expect(workingDayAfter(withHoliday, '2026-10-22', 2)).toBe('2026-10-25');
    // One day later is a Friday.
    expect(workingDayAfter(cal, '2026-10-22', 1)).toBe('2026-10-24');
    expect(workingDayAfter(cal, '2026-10-22', -3)).toBe('2026-10-22');
  });
});
