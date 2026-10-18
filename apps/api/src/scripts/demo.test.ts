import { describe, expect, it } from 'vitest';

import { demoMode, nextDailyRun } from './demo.js';

describe('demo mode', () => {
  it('is on only when DEMO_MODE says so', () => {
    expect(demoMode({ DEMO_MODE: 'true' })).toBe(true);
    expect(demoMode({ DEMO_MODE: '1' })).toBe(true);
    expect(demoMode({})).toBe(false);
    expect(demoMode({ DEMO_MODE: 'false' })).toBe(false);
  });

  it('schedules the nightly reset at the next 05:00 in Tehran', () => {
    // 2026-10-18 04:00 Tehran (UTC+3:30) → today 05:00; 06:00 → tomorrow 05:00.
    expect(
      nextDailyRun(new Date('2026-10-18T00:30:00Z'), '05:00', 'Asia/Tehran').toISOString(),
    ).toBe('2026-10-18T01:30:00.000Z');
    expect(
      nextDailyRun(new Date('2026-10-18T02:30:00Z'), '05:00', 'Asia/Tehran').toISOString(),
    ).toBe('2026-10-19T01:30:00.000Z');
  });
});
