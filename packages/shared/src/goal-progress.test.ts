import { describe, expect, it } from 'vitest';

import { GOAL_DEPTH_MAX, keyResultRange, PARENT_LEVELS } from './contracts/goals.js';
import { goalProgress, keyResultProgress, worstStatus } from './goal-progress.js';

describe('keyResultProgress', () => {
  it('measures an increasing number from its start', () => {
    const kr = { kind: 'number' as const, startValue: 20_000, targetValue: 50_000 };
    expect(keyResultProgress({ ...kr, currentValue: 35_000 })).toBe(0.5);
    expect(keyResultProgress({ ...kr, currentValue: 10_000 })).toBe(0);
    expect(keyResultProgress({ ...kr, currentValue: 60_000 })).toBe(1);
  });

  it('measures a decreasing target', () => {
    const kr = { kind: 'number' as const, startValue: 24, targetValue: 4 };
    expect(keyResultProgress({ ...kr, currentValue: 14 })).toBe(0.5);
    expect(keyResultProgress({ ...kr, currentValue: 2 })).toBe(1);
    expect(keyResultProgress({ ...kr, currentValue: 30 })).toBe(0);
  });

  it('handles percent and done/not done', () => {
    expect(
      keyResultProgress({ kind: 'percent', startValue: 0, targetValue: 100, currentValue: 40 }),
    ).toBe(0.4);
    expect(
      keyResultProgress({ kind: 'boolean', startValue: 0, targetValue: 1, currentValue: 1 }),
    ).toBe(1);
    expect(
      keyResultProgress({ kind: 'boolean', startValue: 0, targetValue: 1, currentValue: 0 }),
    ).toBe(0);
  });
});

describe('goalProgress', () => {
  it('weighs key results and counts each child goal once', () => {
    expect(
      goalProgress([
        { progress: 1, weight: 3 },
        { progress: 0, weight: 1 },
      ]),
    ).toBe(0.75);
    expect(goalProgress([])).toBe(0);
  });
});

describe('worstStatus', () => {
  it('picks off track over at risk over on track', () => {
    expect(worstStatus(['on_track', 'off_track', 'at_risk'])).toBe('off_track');
    expect(worstStatus(['on_track', null])).toBe('on_track');
    expect(worstStatus([null, undefined])).toBeNull();
  });
});

describe('keyResultRange', () => {
  it('fills defaults and rejects empty ranges', () => {
    expect(keyResultRange({ kind: 'percent' })).toEqual({ startValue: 0, targetValue: 100 });
    expect(keyResultRange({ kind: 'boolean', targetValue: 9 })).toEqual({
      startValue: 0,
      targetValue: 1,
    });
    expect(keyResultRange({ kind: 'number', targetValue: 50 })).toEqual({
      startValue: 0,
      targetValue: 50,
    });
    expect(keyResultRange({ kind: 'number' })).toBeNull();
    expect(keyResultRange({ kind: 'number', startValue: 5, targetValue: 5 })).toBeNull();
    expect(keyResultRange({ kind: 'percent', targetValue: 120 })).toBeNull();
  });
});

describe('goal parents (plan phase-3-step-17a)', () => {
  it('a goal goes under its own level or above, never below', () => {
    expect(PARENT_LEVELS.company).toEqual(['company']);
    expect(PARENT_LEVELS.department).toEqual(['department', 'company']);
    expect(PARENT_LEVELS.individual).toEqual(['individual', 'department', 'company']);
    expect(PARENT_LEVELS.company).not.toContain('department');
    expect(GOAL_DEPTH_MAX).toBe(5);
  });
});
