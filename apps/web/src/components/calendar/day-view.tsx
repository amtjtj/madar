'use client';

import { t } from '@madar/i18n';
import { formatCalendarDate, formatNumber, weekRange, type CalendarLayer } from '@madar/shared';
import { Card, CardContent, DayStrip, DropDay, Skeleton } from '@madar/ui';

import { useCalendarRange } from '@/hooks/calendar';
import { dayHeading } from '@/lib/calendar';

import { DayItems } from './day-items';
import { DueMovesProvider } from './due-moves';
import { TimeGrid } from './time-grid';
import { allDayItems, movableItems, WeekNav } from './week-view';

/** «روز» (plan phase-2-step-14b): the week as a strip, the chosen day's items and its hours. */
export function DayView({
  anchor,
  today,
  layers,
  member,
  timeZone,
  onAnchor,
}: {
  anchor: string;
  today: string;
  layers: CalendarLayer[];
  member?: string;
  timeZone?: string;
  onAnchor: (date: string) => void;
}) {
  // The whole week: the strip shows which days are busy, and it shares the week view's cache.
  const { from, to } = weekRange(anchor);
  const { data, isPending } = useCalendarRange(from, to, layers, member);
  const overdue = data?.overdue ?? [];
  const day = data?.days.find((d) => d.date === anchor);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <WeekNav
          anchor={anchor}
          today={today}
          onAnchor={onAnchor}
          title={t('calendar.weekTitle', {
            from: formatCalendarDate(from, 'medium'),
            to: formatCalendarDate(to, 'long'),
          })}
        />
        {isPending && !data ? (
          <Skeleton className="h-[28rem] rounded-xl" />
        ) : data && day ? (
          <DueMovesProvider
            items={movableItems(data.days, today, overdue)}
            days={data.days}
            today={today}
          >
            <DayStrip
              label={t('calendar.weekDays')}
              selected={anchor}
              onSelect={onAnchor}
              days={data.days.map((d) => ({
                date: d.date,
                today: d.date === today,
                off: d.off || d.holiday,
                busy: d.items.length > 0 || (d.date === today && overdue.length > 0),
              }))}
              dayLabel={(d) =>
                t('calendar.dayColumn', {
                  date: formatCalendarDate(d.date, 'full'),
                  count: formatNumber(
                    (data.days.find((x) => x.date === d.date)?.items.length ?? 0) +
                      (d.date === today ? overdue.length : 0),
                  ),
                })
              }
            />
            <h2 className="text-sm font-bold text-ink">{dayHeading(anchor, today)}</h2>
            <TimeGrid
              days={[day]}
              today={today}
              timeZone={timeZone}
              dayLabel={(d) => dayHeading(d.date, today)}
              allDay={(d) => {
                const items = allDayItems(d, today, overdue);
                return (
                  <DropDay date={d.date} className="h-full p-1">
                    {items.length ? (
                      <>
                        {d.date === today && overdue.length > 0 && (
                          <DayItems items={overdue} timeZone={timeZone} where="overdue" />
                        )}
                        <DayItems
                          items={items.filter((i) => !(d.date === today && overdue.includes(i)))}
                          timeZone={timeZone}
                          where={d.date}
                        />
                      </>
                    ) : d.items.some((i) => i.meeting) ? null : (
                      <p className="px-2 py-3 text-sm text-ink-subtle">
                        {d.date === today ? t('calendar.emptyToday') : t('calendar.emptyDay')}
                      </p>
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
