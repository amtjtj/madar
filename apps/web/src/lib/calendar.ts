import { t } from '@madar/i18n';
import {
  addDays,
  CALENDAR_LAYERS,
  formatCalendarDate,
  formatTime,
  type CalendarDay,
  type CalendarItem,
  type CalendarLayer,
  type CalendarRange,
} from '@madar/shared';
import type { CalendarLayerKind } from '@madar/ui';

import { periodName } from './goals';

const LAYERS_KEY = 'madar.calendar.layers';

/** The layers this device last chose (all when nothing or nothing valid is stored). */
export function loadLayers(): CalendarLayer[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null') as unknown;
    if (Array.isArray(stored)) {
      return CALENDAR_LAYERS.filter((l) => stored.includes(l));
    }
  } catch {
    // A convenience only.
  }
  return [...CALENDAR_LAYERS];
}

export function saveLayers(layers: CalendarLayer[]): void {
  try {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
  } catch {
    // A convenience only.
  }
}

/** The colour and icon: a task only on the plan shows as the plan layer. */
export function itemLayer(item: CalendarItem): CalendarLayerKind {
  if (item.kind === 'task') return item.task?.due || item.task?.overdue ? 'task' : 'plan';
  return item.kind;
}

export function itemHref(item: CalendarItem): string {
  switch (item.kind) {
    case 'task':
      return `/tasks/${item.id}`;
    case 'meeting':
      return `/meetings/${item.id}`;
    case 'project':
      return `/projects/${item.id}`;
    case 'period':
      return '/goals';
    case 'leave':
      return `/requests/${item.leave?.requestId ?? ''}`;
  }
}

export function itemTitle(item: CalendarItem): string {
  if (item.kind === 'period' && item.period) {
    return t('calendar.periodEnd', { name: periodName(item.period) });
  }
  if (item.kind === 'project') return t('calendar.projectEnd', { title: item.title ?? '' });
  if (item.kind === 'leave') return t('calendar.leaveDay');
  return item.title ?? '';
}

/** «۱۰:۰۰ تا ۱۱:۰۰» for a meeting; nothing for an all-day item. */
export function itemTime(item: CalendarItem, timeZone?: string): string | undefined {
  if (item.leave?.startsAt && item.leave.endsAt) {
    return t('meetings.time', {
      start: formatTime(new Date(item.leave.startsAt), timeZone),
      end: formatTime(new Date(item.leave.endsAt), timeZone),
    });
  }
  if (!item.meeting) return undefined;
  return t('meetings.time', {
    start: formatTime(new Date(item.meeting.startsAt), timeZone),
    end: formatTime(new Date(item.meeting.endsAt), timeZone),
  });
}

/** «امروز، پنجشنبه ۱ آبان ۱۴۰۵», «فردا، …» or the full date. */
export function dayHeading(date: string, today: string): string {
  const full = formatCalendarDate(date, 'full');
  if (date === today)
    return t('calendar.dayHeading', { relative: t('calendar.today'), date: full });
  if (date === addDays(today, 1)) {
    return t('calendar.dayHeading', { relative: t('calendar.tomorrow'), date: full });
  }
  return full;
}

/** Meetings by time first, then the all-day items. */
export function sortItems(items: CalendarItem[]): CalendarItem[] {
  return [...items].sort((a, b) => {
    const at = a.meeting?.startsAt ?? '~';
    const bt = b.meeting?.startsAt ?? '~';
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
}

/** A task row the viewer may move to another day (drag or «تغییر سررسید»). */
export function movable(item: CalendarItem): boolean {
  const task = item.task;
  return (
    item.kind === 'task' &&
    task !== null &&
    task.editable &&
    (task.due || task.overdue) &&
    (task.statusCategory === 'todo' || task.statusCategory === 'in_progress')
  );
}

/** The drag id of an item on a day (or in the past-due list): a task can be on two days. */
export const dragKey = (where: string, item: CalendarItem) => `${where}|${item.id}`;

/**
 * A range after a task's due date moved to `date` (the optimistic update, plan phase-2-step-14b):
 * its due item leaves its old day or the past-due list (a plan item stays, no longer due) and lands
 * on `date`, or in the past-due list when `date` is before today.
 */
export function moveDueInRange(
  range: CalendarRange,
  taskId: string,
  date: string,
  today: string,
): CalendarRange {
  const found = [...range.overdue, ...range.days.flatMap((d) => d.items)].find(
    (i) => i.kind === 'task' && i.id === taskId,
  );
  if (!found?.task) return range;
  const base = found.task;
  const strip = (items: CalendarItem[]) =>
    items.flatMap((i) => {
      if (i.kind !== 'task' || i.id !== taskId || !i.task) return [i];
      return i.task.planned
        ? [{ ...i, task: { ...i.task, due: false, overdue: false, dueOn: date } }]
        : [];
    });
  const movedTask = {
    ...base,
    due: true,
    planned: false,
    overdue: date < today,
    dueOn: date,
    version: base.version + 1,
  };
  const moved: CalendarItem = { ...found, task: movedTask };
  const holdsToday = range.days.some((d) => d.date === today);
  const overdue = range.overdue.filter((i) => i.id !== taskId);
  if (date < today && holdsToday) overdue.push(moved);
  const days = range.days.map((day) => {
    const items = strip(day.items);
    if (day.date !== date || date < today) return { ...day, items };
    const planned = items.find((i) => i.kind === 'task' && i.id === taskId);
    if (planned?.task) {
      return {
        ...day,
        items: items.map((i) =>
          i === planned && i.task ? { ...i, task: { ...movedTask, planned: true } } : i,
        ),
      };
    }
    return { ...day, items: [...items, moved] };
  });
  return { ...range, days, overdue };
}

/**
 * The items of a day that are not in the hour grid, each with where it came from (its drag key):
 * past-due tasks (on today) first, then the day's own items. A late task on today's plan comes in
 * the day's items, so its key is the day, not «overdue».
 */
export function allDayItems(
  day: CalendarDay,
  today: string,
  overdue: CalendarItem[],
): Array<{ item: CalendarItem; where: string }> {
  return [
    ...(day.date === today ? overdue.map((item) => ({ item, where: 'overdue' })) : []),
    ...sortItems(day.items.filter((i) => !i.meeting)).map((item) => ({ item, where: day.date })),
  ];
}

/** Every movable item of a range by its drag key, for the drag-and-drop lookups. */
export function movableItems(
  days: CalendarDay[],
  overdue: CalendarItem[],
): Map<string, CalendarItem> {
  const map = new Map<string, CalendarItem>();
  for (const item of overdue) if (movable(item)) map.set(dragKey('overdue', item), item);
  for (const day of days) {
    for (const item of day.items) if (movable(item)) map.set(dragKey(day.date, item), item);
  }
  return map;
}
