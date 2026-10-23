import { describe, expect, it } from 'vitest';
import type { CalendarItem, CalendarRange } from '@madar/shared';

import {
  dayHeading,
  itemHref,
  itemLayer,
  itemTitle,
  movable,
  moveDueInRange,
  sortItems,
} from './calendar';

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

describe('moving a due date', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const day = (date: string, items: CalendarItem[]) => ({
    date,
    off: false,
    holiday: false,
    hours: null,
    items,
  });
  const due = (
    dueOn: string,
    extra: Partial<NonNullable<CalendarItem['task']>> = {},
  ): CalendarItem => {
    const item = task(true, false);
    return item.task ? { ...item, task: { ...item.task, dueOn, ...extra } } : item;
  };
  const range = (days: ReturnType<typeof day>[], overdue: CalendarItem[] = []): CalendarRange => ({
    days,
    overdue,
    truncated: [],
    member: { id, displayName: 'علی' },
  });

  it('moves a due item to another day and bumps its version', () => {
    const before = range([day('2026-10-24', [due('2026-10-24')]), day('2026-10-26', [])]);
    const after = moveDueInRange(before, id, '2026-10-26', '2026-10-24');
    expect(after.days[0]?.items).toEqual([]);
    expect(after.days[1]?.items[0]?.task).toMatchObject({ dueOn: '2026-10-26', version: 2 });
  });

  it('keeps a plan item on its day, and merges with a plan item on the new day', () => {
    const planned = due('2026-10-24', { planned: true });
    const plannedLater = { ...task(false, true) };
    const before = range([day('2026-10-24', [planned]), day('2026-10-25', [plannedLater])]);
    const after = moveDueInRange(before, id, '2026-10-25', '2026-10-24');
    expect(after.days[0]?.items[0]?.task).toMatchObject({ due: false, planned: true });
    expect(after.days[1]?.items).toHaveLength(1);
    expect(after.days[1]?.items[0]?.task).toMatchObject({ due: true, planned: true });
  });

  it('takes a late task out of the past-due list, and puts one moved to the past into it', () => {
    const late = due('2026-10-20', { overdue: true });
    const before = range([day('2026-10-24', []), day('2026-10-25', [])], [late]);
    const after = moveDueInRange(before, id, '2026-10-25', '2026-10-24');
    expect(after.overdue).toEqual([]);
    expect(after.days[1]?.items).toHaveLength(1);
    const back = moveDueInRange(after, id, '2026-10-22', '2026-10-24');
    expect(back.overdue[0]?.task).toMatchObject({ overdue: true, dueOn: '2026-10-22' });
    expect(back.days.flatMap((d) => d.items)).toEqual([]);
  });

  it('lets only open, editable, dated tasks move', () => {
    expect(movable(due('2026-10-24'))).toBe(true);
    expect(movable(task(false, true))).toBe(false);
    expect(movable(due('2026-10-24', { editable: false }))).toBe(false);
    expect(movable(due('2026-10-24', { statusCategory: 'done' }))).toBe(false);
  });
});
