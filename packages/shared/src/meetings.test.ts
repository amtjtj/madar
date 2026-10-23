import { describe, expect, it } from 'vitest';

import { zonedInstant } from './locale/work-calendar.js';
import {
  meetingTimeError,
  safeMeetingLink,
  seriesDates,
  taskTitleFromDecision,
  upcomingGroup,
} from './meetings.js';

const tz = 'Asia/Tehran';

describe('meetingTimeError', () => {
  const start = new Date('2026-10-22T06:30:00Z');
  it('accepts an end after the start', () => {
    expect(meetingTimeError(start, new Date('2026-10-22T07:30:00Z'))).toBeNull();
  });
  it('rejects an end at or before the start', () => {
    expect(meetingTimeError(start, start)).toBe('ends_before_start');
    expect(meetingTimeError(start, new Date('2026-10-22T06:00:00Z'))).toBe('ends_before_start');
  });
  it('rejects a meeting longer than a day', () => {
    expect(meetingTimeError(start, new Date('2026-10-23T07:00:00Z'))).toBe('too_long');
  });
});

describe('safeMeetingLink', () => {
  it('keeps http and https links', () => {
    expect(safeMeetingLink(' https://meet.example.ir/abc ')).toBe('https://meet.example.ir/abc');
    expect(safeMeetingLink('http://10.0.0.5/room')).toBe('http://10.0.0.5/room');
  });
  it('rejects other schemes and junk', () => {
    expect(safeMeetingLink('javascript:alert(1)')).toBeNull();
    expect(safeMeetingLink('data:text/html,hi')).toBeNull();
    expect(safeMeetingLink('meet room 3')).toBeNull();
  });
});

describe('upcomingGroup', () => {
  // Thursday 1405/07/30, 10:00 Tehran.
  const now = zonedInstant('2026-10-22', '10:00', tz);
  it('groups by the company day', () => {
    expect(upcomingGroup(zonedInstant('2026-10-22', '23:30', tz), now, tz)).toBe('today');
    expect(upcomingGroup(zonedInstant('2026-10-23', '00:30', tz), now, tz)).toBe('tomorrow');
  });
  it('ends the week on Friday', () => {
    // Friday is tomorrow, so Saturday is already next week.
    expect(upcomingGroup(zonedInstant('2026-10-24', '09:00', tz), now, tz)).toBe('later');
    const saturday = zonedInstant('2026-10-24', '09:00', tz);
    expect(upcomingGroup(zonedInstant('2026-10-27', '09:00', tz), saturday, tz)).toBe('week');
    expect(upcomingGroup(zonedInstant('2026-10-31', '09:00', tz), saturday, tz)).toBe('later');
  });
  it('puts a meeting already under way in today', () => {
    expect(upcomingGroup(zonedInstant('2026-10-22', '09:30', tz), now, tz)).toBe('today');
  });
});

describe('taskTitleFromDecision', () => {
  it('takes the first line', () => {
    expect(taskTitleFromDecision('  بررسی صف برداشت\nجزئیات بیشتر')).toBe('بررسی صف برداشت');
  });
  it('cuts long text', () => {
    expect(taskTitleFromDecision('ا'.repeat(300))).toHaveLength(200);
  });
});

describe('seriesDates', () => {
  // 2026-10-24 is a Saturday (weekday 0).
  const series = { startsOn: '2026-10-22', weekday: 0, untilOn: null };
  it('meets every week on its weekday', () => {
    expect(seriesDates(series, '2026-10-22', '2026-11-14')).toEqual([
      '2026-10-24',
      '2026-10-31',
      '2026-11-07',
      '2026-11-14',
    ]);
  });
  it('skips holidays and stops at its last day', () => {
    expect(
      seriesDates({ ...series, untilOn: '2026-11-10' }, '2026-10-22', '2026-12-31', ['2026-10-31']),
    ).toEqual(['2026-10-24', '2026-11-07']);
  });
  it('never starts before its first day', () => {
    expect(seriesDates({ ...series, startsOn: '2026-11-01' }, '2026-10-01', '2026-11-08')).toEqual([
      '2026-11-07',
    ]);
  });
});
