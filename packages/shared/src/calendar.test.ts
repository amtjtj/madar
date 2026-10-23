import { describe, expect, it } from 'vitest';

import { daysInRange, layoutOverlaps, monthRange, timeGridSpan, weekRange } from './calendar.js';
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

describe('week grid helpers', () => {
  it('finds the Saturday-to-Friday week', () => {
    // 2026-10-23 is a Friday.
    expect(weekRange('2026-10-23')).toEqual({ from: '2026-10-17', to: '2026-10-23' });
    expect(weekRange('2026-10-24')).toEqual({ from: '2026-10-24', to: '2026-10-30' });
  });

  it('spans working hours and widens for events outside them', () => {
    const hours = [{ start: '09:00', end: '18:00' }, { start: '09:00', end: '13:00' }, null];
    expect(timeGridSpan(hours)).toEqual({ startHour: 9, endHour: 18 });
    expect(timeGridSpan(hours, [{ start: 7 * 60 + 30, end: 8 * 60 }])).toEqual({
      startHour: 7,
      endHour: 18,
    });
    expect(timeGridSpan(hours, [{ start: 19 * 60, end: 20 * 60 + 15 }]).endHour).toBe(21);
    expect(timeGridSpan([null])).toEqual({ startHour: 8, endHour: 18 });
  });

  it('puts overlapping events side by side', () => {
    const layout = layoutOverlaps([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 570, end: 630 },
      { id: 'c', start: 600, end: 660 }, // reuses a's column
      { id: 'd', start: 700, end: 760 }, // alone
    ]);
    expect(layout.get('a')).toEqual({ column: 0, columns: 2 });
    expect(layout.get('b')).toEqual({ column: 1, columns: 2 });
    expect(layout.get('c')).toEqual({ column: 0, columns: 2 });
    expect(layout.get('d')).toEqual({ column: 0, columns: 1 });
  });

  it('accepts a member and refuses a bad one', () => {
    expect(
      calendarQuery.safeParse({ from: '2026-10-24', to: '2026-10-30', member: 'x' }).success,
    ).toBe(false);
  });
});

describe('assistant contracts', () => {
  it('trims and bounds a sentence, and caps suggestions', async () => {
    const { taskBreakdownRequest, taskBreakdownResponse, TASK_BREAKDOWN_MAX } =
      await import('./contracts/ai.js');
    const id = '00000000-0000-4000-8000-000000000001';
    expect(
      taskBreakdownRequest.parse({ sentence: '  کمپین یلدا  ', departmentId: id }).sentence,
    ).toBe('کمپین یلدا');
    expect(taskBreakdownRequest.safeParse({ sentence: 'ab', departmentId: id }).success).toBe(
      false,
    );
    const many = Array.from({ length: TASK_BREAKDOWN_MAX + 1 }, () => ({
      title: 'x',
      dueOn: null,
    }));
    expect(taskBreakdownResponse.safeParse({ tasks: many }).success).toBe(false);
  });
});
