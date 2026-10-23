'use client';

import { CalendarDays } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import {
  addDays,
  formatCalendarDate,
  formatNumber,
  persianWeekdayOfCalendarDate,
  type CalendarDay,
} from '@madar/shared';
import { Card, CardContent, CalendarItemRow, Skeleton, cn } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useCalendarRange } from '@/hooks/calendar';
import { useMe } from '@/hooks/use-me';
import { useTodayDate } from '@/hooks/work';
import { itemHref, itemLayer, itemTime, itemTitle, loadLayers, sortItems } from '@/lib/calendar';

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** How many rows of the chosen day show before «و n مورد دیگر». */
const PREVIEW_ROWS = 5;

/**
 * «تقویم این هفته» on the home page (plan phase-3-step-17a): the next seven days with a dot per
 * day that has something, the chosen day's items below, and the full calendar one tap away. Same
 * data, layers and visibility as `/calendar`.
 */
export function CalendarPreview() {
  const today = useTodayDate();
  const { data: me } = useMe();
  const [layers] = useState(loadLayers);
  const [picked, setPicked] = useState<string | null>(null);
  const { data, isPending } = useCalendarRange(today, addDays(today, 6), layers);
  const timeZone = me?.tenant?.timezone;
  const chosen = picked ?? today;
  const day = data?.days.find((d) => d.date === chosen);
  const items = day ? sortItems(day.items) : [];

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold text-ink [&_svg]:size-5 [&_svg]:text-primary-ink">
            <CalendarDays aria-hidden />
            {t('home.calendar.title')}
          </h2>
          <NextLink
            href="/calendar"
            className="text-sm font-semibold text-primary-ink hover:underline"
          >
            {t('home.calendar.open')}
          </NextLink>
        </div>
        {isPending && !data ? (
          <div className="flex flex-col gap-3" aria-busy>
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
        ) : (
          <>
            <div
              role="group"
              aria-label={t('home.calendar.days')}
              className="grid grid-cols-7 gap-1"
            >
              {(data?.days ?? []).map((d) => (
                <DayButton
                  key={d.date}
                  day={d}
                  today={d.date === today}
                  selected={d.date === chosen}
                  onSelect={() => setPicked(d.date)}
                />
              ))}
            </div>
            {items.length === 0 ? (
              <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-muted">
                {day?.holiday || day?.off ? t('home.calendar.dayOff') : t('home.calendar.nothing')}
              </p>
            ) : (
              <ul className="-mx-2 flex flex-col">
                {items.slice(0, PREVIEW_ROWS).map((item) => (
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
                    />
                  </li>
                ))}
              </ul>
            )}
            {items.length > PREVIEW_ROWS && (
              <NextLink
                href="/calendar"
                className="self-start text-sm font-semibold text-primary-ink hover:underline"
              >
                {t('home.calendar.more', { count: formatNumber(items.length - PREVIEW_ROWS) })}
              </NextLink>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DayButton({
  day,
  today,
  selected,
  onSelect,
}: {
  day: CalendarDay;
  today: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const count = day.items.length;
  const label = [
    formatCalendarDate(day.date, 'full'),
    today ? t('calendar.today') : null,
    count ? t('home.calendar.count', { count: formatNumber(count) }) : t('home.calendar.empty'),
  ]
    .filter(Boolean)
    .join('، ');
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-sm transition-colors',
        selected ? 'bg-primary-soft font-bold text-primary-ink' : 'hover:bg-sunken',
        !selected && (day.off || day.holiday) && 'text-ink-subtle',
        today && 'ring-1 ring-primary-edge',
      )}
    >
      <span className="text-xs">
        {t(`home.calendar.weekdays.w${persianWeekdayOfCalendarDate(day.date) as Weekday}`)}
      </span>
      <span className="font-bold tabular-nums">
        {formatCalendarDate(day.date, 'medium').split(' ')[0]}
      </span>
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', count ? 'bg-primary' : 'bg-transparent')}
      />
    </button>
  );
}
