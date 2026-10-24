import { describe, expect, it } from 'vitest';

import {
  BADGES,
  badgesReached,
  currentStreak,
  dayStatus,
  isCompleteDay,
  levelOf,
  longestStreak,
  neededForCompleteDay,
  taskXp,
  underCap,
  xpForLevel,
  type StreakStatus,
} from './gamification.js';
import { DEFAULT_WORK_CALENDAR } from './locale/work-calendar.js';

// 1405/08/03 is a Saturday (2026-10-25); Friday 2026-10-30 is the weekly day off.
const calendar = { ...DEFAULT_WORK_CALENDAR, holidays: ['2026-10-27'] };

describe('XP', () => {
  it('weighs work by the manager’s weight and pays a little extra on time', () => {
    expect(
      taskXp({ weight: 3, source: 'assigned', dueOn: '2026-10-25', completedOn: '2026-10-25' }),
    ).toEqual({ completed: 30, onTime: 15, helped: 0 });
    expect(
      taskXp({ weight: 3, source: 'assigned', dueOn: '2026-10-24', completedOn: '2026-10-25' }),
    ).toEqual({ completed: 30, onTime: 0, helped: 0 });
    expect(
      taskXp({ weight: 1, source: 'assigned', dueOn: null, completedOn: '2026-10-25' }),
    ).toEqual({ completed: 10, onTime: 0, helped: 0 });
    // A colleague's request inside a shared project: a little extra for helping.
    expect(
      taskXp({ weight: 1, source: 'request', dueOn: null, completedOn: '2026-10-25' }),
    ).toEqual({ completed: 10, onTime: 0, helped: 5 });
  });

  it('gives a self-made task with no weight almost nothing', () => {
    expect(
      taskXp({ weight: 1, source: 'personal', dueOn: '2026-10-30', completedOn: '2026-10-25' }),
    ).toEqual({ completed: 2, onTime: 0, helped: 0 });
    // A manager who weighs their own task gets the weight.
    expect(
      taskXp({ weight: 2, source: 'personal', dueOn: null, completedOn: '2026-10-25' }).completed,
    ).toBe(20);
  });

  it('stops at the daily cap', () => {
    expect(underCap(30, 100, 150)).toBe(30);
    expect(underCap(30, 140, 150)).toBe(10);
    expect(underCap(30, 160, 150)).toBe(0);
  });
});

describe('levels', () => {
  it('needs 50 × L × (L − 1) XP for level L', () => {
    expect([1, 2, 3, 5, 10].map(xpForLevel)).toEqual([0, 100, 300, 1000, 4500]);
    expect(levelOf(0)).toEqual({ level: 1, into: 0, span: 100 });
    expect(levelOf(99).level).toBe(1);
    expect(levelOf(100)).toEqual({ level: 2, into: 0, span: 200 });
    expect(levelOf(1020)).toEqual({ level: 5, into: 20, span: 500 });
    expect(levelOf(-30).level).toBe(1);
  });
});

describe('streaks', () => {
  it('a complete day is 70% of a non-empty plan', () => {
    expect(isCompleteDay(0, 0, 70)).toBe(false);
    expect(isCompleteDay(4, 3, 70)).toBe(true);
    expect(isCompleteDay(3, 2, 70)).toBe(false);
    expect(neededForCompleteDay(4, 1, 70)).toBe(2);
    expect(neededForCompleteDay(0, 0, 70)).toBe(0);
  });

  it('holidays, days off and leave are excused', () => {
    const facts = { planned: 0, done: 0, onLeave: false };
    expect(dayStatus(calendar, '2026-10-27', facts, 70)).toBe('excused_holiday');
    expect(dayStatus(calendar, '2026-10-30', facts, 70)).toBe('off_day');
    expect(dayStatus(calendar, '2026-10-25', { ...facts, onLeave: true }, 70)).toBe(
      'excused_leave',
    );
    expect(dayStatus(calendar, '2026-10-25', facts, 70)).toBe('missed');
    expect(dayStatus(calendar, '2026-10-25', { planned: 2, done: 2, onLeave: false }, 70)).toBe(
      'completed',
    );
  });

  it('counts completed days back to the first missed one, skipping excused days', () => {
    const days: Array<{ day: string; status: StreakStatus }> = [
      { day: '2026-10-25', status: 'missed' },
      { day: '2026-10-26', status: 'completed' },
      { day: '2026-10-27', status: 'excused_holiday' },
      { day: '2026-10-28', status: 'completed' },
      { day: '2026-10-29', status: 'excused_leave' },
      { day: '2026-10-30', status: 'off_day' },
      { day: '2026-10-31', status: 'completed' },
    ];
    expect(currentStreak(days)).toBe(3);
    expect(longestStreak(days)).toBe(3);
    // A day never closed (here Thursday the 29th) is skipped, not counted as missed.
    expect(currentStreak(days.filter((d) => d.day !== '2026-10-29'))).toBe(3);
    expect(currentStreak(days.slice(0, 1))).toBe(0);
  });
});

describe('badges', () => {
  it('are reached by their counters, each once in the catalog', () => {
    expect(new Set(BADGES.map((b) => b.key)).size).toBe(BADGES.length);
    expect(badgesReached({})).toEqual([]);
    expect(badgesReached({ tasks_completed: 12, kudos_given: 1 })).toEqual([
      'first_task',
      'tasks_10',
      'first_thanks',
    ]);
    expect(badgesReached({ longest_streak: 20, level: 5 })).toEqual([
      'streak_5',
      'streak_20',
      'level_5',
    ]);
  });
});
