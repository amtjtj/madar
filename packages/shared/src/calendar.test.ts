import { describe, expect, it } from 'vitest';

import { daysInRange, monthRange } from './calendar.js';
import { calendarQuery } from './contracts/calendar.js';
import { persianWeekdayOfCalendarDate } from './locale/jalali.js';

describe('calendar ranges', () => {
  it('covers a Jalali month in whole Saturday-to-Friday weeks', () => {
    // Aban 1405 starts on Friday 2026-10-23.
    const { from, to } = monthRange(1405, 8);
    expect(persianWeekdayOfCalendarDate(from)).toBe(0);
    expect(persianWeekdayOfCalendarDate(to)).toBe(6);
    expect(from <= '2026-10-23' && to >= '2026-11-21').toBe(true);
    expect(daysInRange(from, to).length % 7).toBe(0);
    expect(daysInRange(from, to).length).toBeLessThanOrEqual(42);
  });

  it('lists days inclusively', () => {
    expect(daysInRange('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('takes known layers and refuses long or reversed ranges', () => {
    expect(
      calendarQuery.parse({ from: '2026-10-01', to: '2026-10-02', layers: 'tasks,x,meetings' })
        .layers,
    ).toEqual(['tasks', 'meetings']);
    expect(calendarQuery.parse({ from: '2026-10-01', to: '2026-10-02' }).layers).toHaveLength(6);
    expect(calendarQuery.safeParse({ from: '2026-10-01', to: '2026-11-11' }).success).toBe(true);
    expect(calendarQuery.safeParse({ from: '2026-10-01', to: '2026-11-12' }).success).toBe(false);
    expect(calendarQuery.safeParse({ from: '2026-10-05', to: '2026-10-01' }).success).toBe(false);
  });
});
