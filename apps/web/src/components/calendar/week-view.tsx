'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '@madar/i18n';
import {
  addDays,
  formatCalendarDate,
  formatNumber,
  weekRange,
  type CalendarLayer,
} from '@madar/shared';
import { Button, Card, CardContent, DragItem, DropDay, Skeleton, cn } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useCalendarRange } from '@/hooks/calendar';
import {
  allDayItems,
  dragKey,
  itemHref,
  itemLayer,
  itemTitle,
  movable,
  movableItems,
} from '@/lib/calendar';

import { ChangeDueButton, DueMovesProvider } from './due-moves';
import { CalendarError } from './calendar-error';
import { TimeGrid } from './time-grid';

const chipTone = {
  task: 'bg-layer-task-soft',
  plan: 'bg-layer-plan-soft',
  meeting: 'bg-layer-meeting-soft',
  project: 'bg-layer-project-soft',
  period: 'bg-layer-period-soft',
} as const;
const ALL_DAY_SHOWN = 3;

/** Previous, next and back to this week; the title in between. */
export function WeekNav({
  anchor,
  today,
  onAnchor,
  title,
}: {
  anchor: string;
  today: string;
  onAnchor: (date: string) => void;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('calendar.previousWeek')}
        icon={<ChevronRight aria-hidden />}
        onClick={() => onAnchor(addDays(anchor, -7))}
      />
      <div className="flex items-center gap-2">
        <span className="font-bold text-ink" aria-live="polite">
          {title}
        </span>
        <Button variant="secondary" size="sm" onClick={() => onAnchor(today)}>
          {t('calendar.backToToday')}
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('calendar.nextWeek')}
        icon={<ChevronLeft aria-hidden />}
        onClick={() => onAnchor(addDays(anchor, 7))}
      />
    </div>
  );
}

/** «هفته» (plan phase-2-step-14b): seven days, an all-day row and meetings on the hour grid. */
export function WeekView({
  anchor,
  today,
  layers,
  member,
  timeZone,
  onAnchor,
  onOpenDay,
}: {
  anchor: string;
  today: string;
  layers: CalendarLayer[];
  member?: string;
  timeZone?: string;
  onAnchor: (date: string) => void;
  onOpenDay: (date: string) => void;
}) {
  const { from, to } = weekRange(anchor);
  const { data, isPending, error } = useCalendarRange(from, to, layers, member);
  const title = t('calendar.weekTitle', {
    from: formatCalendarDate(from, 'medium'),
    to: formatCalendarDate(to, 'long'),
  });
  const overdue = data?.overdue ?? [];
  const empty = data && overdue.length === 0 && data.days.every((d) => d.items.length === 0);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <WeekNav anchor={anchor} today={today} onAnchor={onAnchor} title={title} />
        {data?.truncated.length ? (
          <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning-ink">
            {t('calendar.truncated')}
          </p>
        ) : null}
        {empty && <p className="text-sm text-ink-subtle">{t('calendar.emptyWeek')}</p>}
        {error && !data ? (
          <CalendarError error={error} />
        ) : isPending && !data ? (
          <Skeleton className="h-[32rem] rounded-xl" />
        ) : data ? (
          <DueMovesProvider items={movableItems(data.days, overdue)} days={data.days} today={today}>
            <TimeGrid
              days={data.days}
              today={today}
              timeZone={timeZone}
              dayLabel={(day) =>
                t('calendar.dayColumn', {
                  date: formatCalendarDate(day.date, 'full'),
                  count: formatNumber(
                    allDayItems(day, today, overdue).length +
                      day.items.filter((i) => i.meeting).length,
                  ),
                })
              }
              allDay={(day) => {
                const items = allDayItems(day, today, overdue);
                const more = items.length - ALL_DAY_SHOWN;
                return (
                  <DropDay date={day.date} className="flex h-full flex-col gap-1 p-1">
                    {items.slice(0, ALL_DAY_SHOWN).map(({ item, where }) => {
                      const chip = (handle: ReactNode) => (
                        <div
                          className={cn(
                            'flex min-w-0 items-center rounded-md text-[0.6875rem] leading-5 text-ink',
                            chipTone[itemLayer(item)],
                            item.task?.overdue && 'ring-1 ring-danger',
                          )}
                        >
                          {handle}
                          <NextLink
                            href={itemHref(item)}
                            className="min-w-0 flex-1 truncate px-1 py-0.5 hover:underline"
                          >
                            {itemTitle(item)}
                          </NextLink>
                          {movable(item) && <ChangeDueButton item={item} compact />}
                        </div>
                      );
                      return (
                        <div key={`${item.kind}:${item.id}`}>
                          {movable(item) ? (
                            <DragItem id={dragKey(where, item)} title={itemTitle(item)}>
                              {chip}
                            </DragItem>
                          ) : (
                            chip(null)
                          )}
                        </div>
                      );
                    })}
                    {more > 0 && (
                      <button
                        type="button"
                        onClick={() => onOpenDay(day.date)}
                        aria-label={t('calendar.openDay', {
                          date: formatCalendarDate(day.date, 'full'),
                        })}
                        className="self-start rounded px-1 text-[0.6875rem] font-semibold text-primary-ink hover:underline"
                      >
                        <span dir="ltr">
                          {t('ui.calendar.more', { count: formatNumber(more) })}
                        </span>
                      </button>
                    )}
                  </DropDay>
                );
              }}
            />
          </DueMovesProvider>
        ) : null}
      </CardContent>
    </Card>
  );
}
