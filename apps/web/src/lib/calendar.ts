import { t } from '@madar/i18n';
import {
  addDays,
  CALENDAR_LAYERS,
  formatCalendarDate,
  formatTime,
  type CalendarItem,
  type CalendarLayer,
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
  }
}

export function itemTitle(item: CalendarItem): string {
  if (item.kind === 'period' && item.period) {
    return t('calendar.periodEnd', { name: periodName(item.period) });
  }
  if (item.kind === 'project') return t('calendar.projectEnd', { title: item.title ?? '' });
  return item.title ?? '';
}

/** «۱۰:۰۰ تا ۱۱:۰۰» for a meeting; nothing for an all-day item. */
export function itemTime(item: CalendarItem, timeZone?: string): string | undefined {
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
