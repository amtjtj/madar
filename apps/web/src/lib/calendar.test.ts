import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '@madar/shared';

import { dayHeading, itemHref, itemLayer, itemTitle, sortItems } from './calendar';

const base = { task: null, meeting: null, project: null, period: null } as const;
const task = (due: boolean, planned: boolean): CalendarItem => ({
  ...base,
  kind: 'task',
  id: '00000000-0000-4000-8000-000000000001',
  title: 'گزارش',
  task: {
    priority: 'normal',
    statusCategory: 'todo',
    due,
    planned,
    overdue: false,
    dueOn: null,
    version: 1,
    editable: true,
  },
});

describe('calendar items', () => {
  it('colours a task only on the plan as the plan layer', () => {
    expect(itemLayer(task(true, true))).toBe('task');
    expect(itemLayer(task(false, true))).toBe('plan');
  });

  it('names projects and goal periods, and links each kind', () => {
    const period: CalendarItem = {
      ...base,
      kind: 'period',
      id: '00000000-0000-4000-8000-000000000002',
      title: null,
      period: { year: 1405, quarter: 3 },
    };
    expect(itemTitle(period)).toContain('پاییز');
    expect(itemHref(period)).toBe('/goals');
    expect(itemHref(task(true, false))).toBe('/tasks/00000000-0000-4000-8000-000000000001');
  });

  it('puts meetings first, by time', () => {
    const meeting = (startsAt: string): CalendarItem => ({
      ...base,
      kind: 'meeting',
      id: '00000000-0000-4000-8000-000000000003',
      title: startsAt,
      meeting: { startsAt, endsAt: startsAt, type: 'regular', canceled: false, myResponse: null },
    });
    const sorted = sortItems([
      task(true, false),
      meeting('2026-10-24T08:00:00.000Z'),
      meeting('2026-10-24T06:00:00.000Z'),
    ]);
    expect(sorted.map((i) => i.kind)).toEqual(['meeting', 'meeting', 'task']);
    expect(sorted[0]?.title).toBe('2026-10-24T06:00:00.000Z');
  });

  it('words today and tomorrow', () => {
    expect(dayHeading('2026-10-22', '2026-10-22')).toMatch(/^امروز، /);
    expect(dayHeading('2026-10-23', '2026-10-22')).toMatch(/^فردا، /);
    expect(dayHeading('2026-10-25', '2026-10-22')).not.toMatch(/^(امروز|فردا)/);
  });
});
