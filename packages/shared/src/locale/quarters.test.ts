import { describe, expect, it } from 'vitest';

import { jalaliQuarter, jalaliQuarterOf, nextJalaliQuarter } from './quarters.js';

describe('Jalali quarters', () => {
  it('autumn 1405 runs from 1 Mehr to 30 Azar', () => {
    expect(jalaliQuarterOf('2026-10-18')).toEqual({
      year: 1405,
      quarter: 3,
      startOn: '2026-09-23',
      endOn: '2026-12-21',
    });
  });

  it('spring and summer months have 31 days', () => {
    expect(jalaliQuarter(1405, 1)).toMatchObject({ startOn: '2026-03-21', endOn: '2026-06-21' });
    expect(jalaliQuarter(1405, 2)).toMatchObject({ startOn: '2026-06-22', endOn: '2026-09-22' });
  });

  it('winter ends on 30 Esfand in a leap year and 29 otherwise', () => {
    expect(jalaliQuarter(1403, 4).endOn).toBe('2025-03-20'); // 1403 is leap: 30 Esfand
    expect(jalaliQuarter(1404, 4).endOn).toBe('2026-03-20'); // 29 Esfand
  });

  it('wraps from winter to the next spring', () => {
    expect(nextJalaliQuarter({ year: 1405, quarter: 4 })).toMatchObject({ year: 1406, quarter: 1 });
    expect(nextJalaliQuarter({ year: 1405, quarter: 3 })).toMatchObject({ year: 1405, quarter: 4 });
  });

  it('consecutive quarters leave no gap', () => {
    const autumn = jalaliQuarter(1405, 3);
    const winter = nextJalaliQuarter(autumn);
    const dayAfter = new Date(`${autumn.endOn}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    expect(winter.startOn).toBe(dayAfter.toISOString().slice(0, 10));
  });
});
