import { describe, expect, it } from 'vitest';
import { zonedInstant } from '@madar/shared';

import { defaultSlot, groupUpcoming, meetingInstants, meetingTime, wallClock } from './meetings';

const tz = 'Asia/Tehran';

describe('meetings', () => {
  it('words the time with Persian digits', () => {
    const m = {
      startsAt: zonedInstant('2026-10-22', '10:00', tz).toISOString(),
      endsAt: zonedInstant('2026-10-22', '11:30', tz).toISOString(),
    };
    expect(meetingTime(m, tz)).toBe('ساعت ۱۰:۰۰ تا ۱۱:۳۰');
    expect(meetingTime(m, tz, true)).toContain('پنجشنبه');
  });

  it('turns the form into instants and checks it', () => {
    const ok = meetingInstants({ date: '2026-10-22', start: '10:00', end: '11:00', link: '' }, tz);
    expect(ok).toEqual({
      startsAt: '2026-10-22T06:30:00.000Z',
      endsAt: '2026-10-22T07:30:00.000Z',
    });
    expect(
      meetingInstants({ date: '2026-10-22', start: '11:00', end: '10:00', link: '' }, tz),
    ).toHaveProperty('error');
    expect(
      meetingInstants({ date: '2026-10-22', start: '10:00', end: '11:00', link: 'ftp://x' }, tz),
    ).toHaveProperty('error');
  });

  it('groups upcoming meetings by day', () => {
    const now = zonedInstant('2026-10-22', '09:00', tz);
    const at = (d: string) => ({ startsAt: zonedInstant(d, '10:00', tz).toISOString() });
    const groups = groupUpcoming(
      [at('2026-10-22'), at('2026-10-22'), at('2026-10-23'), at('2026-11-02')],
      tz,
      now,
    );
    expect(groups.map((g) => [g.group, g.items.length])).toEqual([
      ['today', 2],
      ['tomorrow', 1],
      ['later', 1],
    ]);
  });

  it('suggests the next full hour', () => {
    const slot = defaultSlot(tz, zonedInstant('2026-10-22', '09:20', tz));
    expect(slot).toEqual({ date: '2026-10-22', start: '10:00', end: '11:00' });
    expect(wallClock(zonedInstant('2026-10-22', '23:30', tz), tz)).toBe('23:30');
  });
});
