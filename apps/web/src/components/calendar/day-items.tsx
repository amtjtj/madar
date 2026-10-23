'use client';

import { t } from '@madar/i18n';
import type { CalendarItem } from '@madar/shared';
import { Badge, CalendarItemRow } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { itemHref, itemLayer, itemTime, itemTitle, sortItems } from '@/lib/calendar';

/** The items of one day (or the past-due list), meetings first. */
export function DayItems({ items, timeZone }: { items: CalendarItem[]; timeZone?: string }) {
  return (
    <ul className="flex flex-col">
      {sortItems(items).map((item) => (
        <li key={`${item.kind}:${item.id}`}>
          <CalendarItemRow
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
        </li>
      ))}
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
