import { describe, expect, it } from 'vitest';

import {
  elapsedShare,
  helpReasons,
  isDepartmentBehind,
  isProjectAtRisk,
  weekEndOf,
  weekStartOf,
  weekStarts,
  workingDaysBefore,
} from './dashboard-rules.js';
import { DEFAULT_WORK_CALENDAR } from './locale/work-calendar.js';

describe('elapsedShare', () => {
  it('measures how much of a range has passed', () => {
    expect(elapsedShare('2026-09-23', '2026-12-21', '2026-09-23')).toBe(0);
    expect(elapsedShare('2026-09-23', '2026-12-21', '2026-12-22')).toBe(1);
    expect(elapsedShare('2026-10-01', '2026-10-10', '2026-10-06')).toBe(0.5);
  });
});

describe('workingDaysBefore', () => {
  it('skips Fridays and holidays', () => {
    // 2026-10-18 is a Sunday; Friday 2026-10-16 is off.
    expect(workingDaysBefore(DEFAULT_WORK_CALENDAR, '2026-10-18', 2)).toBe('2026-10-15');
    const holiday = { ...DEFAULT_WORK_CALENDAR, holidays: ['2026-10-17'] };
    expect(workingDaysBefore(holiday, '2026-10-18', 1)).toBe('2026-10-15');
  });
});

describe('weekStarts', () => {
  it('lists Saturday-based weeks ending with this one', () => {
    expect(weekStarts('2026-10-18', 3)).toEqual(['2026-10-03', '2026-10-10', '2026-10-17']);
  });
});

describe('weekStartOf / weekEndOf', () => {
  it('runs Saturday to Friday', () => {
    expect(weekStartOf('2026-10-18')).toBe('2026-10-17'); // Sunday → Saturday before
    expect(weekStartOf('2026-10-17')).toBe('2026-10-17');
    expect(weekStartOf('2026-10-23')).toBe('2026-10-17'); // Friday
    expect(weekEndOf('2026-10-17')).toBe('2026-10-23');
  });
});

describe('isDepartmentBehind', () => {
  it('flags goals trailing the season or a heavy overdue share', () => {
    const base = { seasonShare: 0.5, openTasks: 10, overdueTasks: 0 };
    expect(isDepartmentBehind({ ...base, goalProgress: 0.3 })).toBe(true);
    expect(isDepartmentBehind({ ...base, goalProgress: 0.4 })).toBe(false);
    expect(isDepartmentBehind({ ...base, goalProgress: null, overdueTasks: 3 })).toBe(true);
    expect(isDepartmentBehind({ ...base, goalProgress: null, overdueTasks: 2 })).toBe(false);
    expect(isDepartmentBehind({ ...base, goalProgress: null, openTasks: 0 })).toBe(false);
  });
});

describe('isProjectAtRisk', () => {
  const base = { startOn: '2026-10-01', dueOn: '2026-10-10', today: '2026-10-06', overdue: 0 };
  it('compares weighted progress with elapsed time', () => {
    expect(isProjectAtRisk({ ...base, progress: 0.2 })).toBe(true); // 20 % done, 50 % elapsed
    expect(isProjectAtRisk({ ...base, progress: 0.4 })).toBe(false);
  });
  it('is at risk with overdue tasks, never without a due date or tasks otherwise', () => {
    expect(isProjectAtRisk({ ...base, progress: 0.9, overdue: 1 })).toBe(true);
    expect(isProjectAtRisk({ ...base, dueOn: null, progress: 0 })).toBe(false);
    expect(isProjectAtRisk({ ...base, progress: null })).toBe(false);
  });
});

describe('helpReasons', () => {
  it('gives reasons, never a score', () => {
    expect(helpReasons({ open: 4, overdue: 1, stuck: 0 })).toEqual([]);
    expect(helpReasons({ open: 20, overdue: 3, stuck: 1 })).toEqual([
      { kind: 'overdue', count: 3 },
      { kind: 'stuck', count: 1 },
      { kind: 'overloaded', count: 20 },
    ]);
  });
});
