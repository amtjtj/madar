'use client';

import type { ReactNode } from 'react';

import { t } from '@madar/i18n';
import type { CalendarItem } from '@madar/shared';
import { Badge, CalendarItemRow, DragItem } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import {
  dragKey,
  itemHref,
  itemLayer,
  itemTime,
  itemTitle,
  movable,
  sortItems,
} from '@/lib/calendar';

import { ChangeDueButton } from './due-moves';

/**
 * The items of one day (or the past-due list), meetings first. `where` is the day (or «overdue»):
 * inside `DueMovesProvider` a movable task gets a drag handle and «تغییر سررسید».
 */
export function DayItems({
  items,
  timeZone,
  where = '',
}: {
  items: CalendarItem[];
  timeZone?: string;
  where?: string;
}) {
  return (
    <ul className="flex flex-col">
      {sortItems(items).map((item) => {
        const row = (handle: ReactNode) => (
          <div className="flex items-center gap-1">
            {handle}
            <CalendarItemRow
              className="min-w-0 flex-1"
              layer={itemLayer(item)}
              title={itemTitle(item)}
              href={itemHref(item)}
              Link={NextLink}
              time={itemTime(item, timeZone)}
              struck={item.meeting?.canceled}
              faded={
                item.meeting?.myResponse === 'declined' ||
                item.task?.statusCategory === 'done' ||
                item.task?.statusCategory === 'canceled'
              }
              tags={<ItemTags item={item} />}
            />
            {movable(item) && <ChangeDueButton item={item} />}
          </div>
        );
        return (
          <li key={`${item.kind}:${item.id}`}>
            {movable(item) ? (
              <DragItem id={dragKey(where, item)} title={itemTitle(item)}>
                {row}
              </DragItem>
            ) : (
              row(null)
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ItemTags({ item }: { item: CalendarItem }) {
  if (item.task) {
    return (
      <>
        {item.task.overdue && <Badge tone="danger">{t('calendar.overdueTag')}</Badge>}
        {item.task.due && !item.task.overdue && item.task.planned && (
          <Badge tone="primary">{t('calendar.dueTag')}</Badge>
        )}
        {item.task.planned && <Badge tone="success">{t('calendar.plannedTag')}</Badge>}
      </>
    );
  }
  if (item.meeting?.canceled) return <Badge tone="danger">{t('calendar.canceledTag')}</Badge>;
  if (item.meeting?.myResponse === 'declined') {
    return <Badge tone="warning">{t('calendar.declinedTag')}</Badge>;
  }
  return null;
}
