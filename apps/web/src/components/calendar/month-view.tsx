'use client';

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';

import { t } from '@madar/i18n';
import {
  formatCalendarDate,
  formatNumber,
  calendarDateOfJalali,
  JALALI_MONTHS,
  jalaliOfCalendarDate,
  monthRange,
  shiftJalaliMonth,
  type CalendarLayer,
} from '@madar/shared';
import { Button, CalendarMonth, Card, CardContent, Modal, Skeleton, cn } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useCalendarRange } from '@/hooks/calendar';
import { dayHeading, itemLayer, itemTitle, movableItems } from '@/lib/calendar';

import { DayItems } from './day-items';
import { CalendarError } from './calendar-error';
import { DueMovesProvider } from './due-moves';

/** A Jalali month with the chosen day's items beside it (a sheet on phones). */
export function MonthView({
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
  const month = jalaliOfCalendarDate(anchor);
  const setMonth = (next: { jy: number; jm: number }) =>
    onAnchor(calendarDateOfJalali({ ...next, jd: 1 }));
  const [selected, setSelected] = useState<string | null>(anchor);
  const [sheet, setSheet] = useState(false);
  const { from, to } = monthRange(month.jy, month.jm);
  const { data, isPending, error } = useCalendarRange(from, to, layers, member);
  const title = `${JALALI_MONTHS[month.jm - 1]} ${formatNumber(month.jy, { useGrouping: false })}`;
  const cells = (data?.days ?? []).map((day) => ({
    date: day.date,
    inMonth: jalaliOfCalendarDate(day.date).jm === month.jm,
    today: day.date === today,
    off: day.off || day.holiday,
    items: [...(day.date === today ? (data?.overdue ?? []) : []), ...day.items].map((item) => ({
      layer: itemLayer(item),
      title: itemTitle(item),
    })),
  }));
  const selectedDay = data?.days.find((d) => d.date === selected);
  const selectedOverdue = selectedDay?.date === today ? (data?.overdue ?? []) : [];
  const selectedItems = selectedDay ? [...selectedOverdue, ...selectedDay.items] : [];
  const dayBody = (
    <>
      {selectedItems.length ? (
        <>
          {selectedOverdue.length > 0 && (
            <DayItems items={selectedOverdue} timeZone={timeZone} where="overdue" />
          )}
          <DayItems items={selectedDay?.items ?? []} timeZone={timeZone} where={selected ?? ''} />
        </>
      ) : (
        <p className="py-2 text-sm text-ink-subtle">{t('calendar.emptyDay')}</p>
      )}
      {/* A meeting can be planned for today or later, never in the past. */}
      {!member && selected && selected >= today && (
        <NextLink
          href={`/meetings/new?date=${selected}`}
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl px-3 text-sm font-semibold text-primary-ink hover:bg-sunken [&_svg]:size-4"
        >
          <Plus aria-hidden />
          {t('calendar.newMeeting')}
        </NextLink>
      )}
    </>
  );

  return (
    <DueMovesProvider
      items={data ? movableItems(data.days, data.overdue) : new Map()}
      days={data?.days ?? []}
      today={today}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <Card className="min-w-0 flex-1">
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex items-center justify-between gap-2">
              {/* RTL: the previous month is on the right (start). */}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('calendar.previousMonth')}
                icon={<ChevronRight aria-hidden />}
                onClick={() => setMonth(shiftJalaliMonth(month.jy, month.jm, -1))}
              />
              <div className="flex items-center gap-2">
                <span className="font-bold text-ink" aria-live="polite">
                  {title}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onAnchor(today);
                    setSelected(today);
                  }}
                >
                  {t('calendar.backToToday')}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('calendar.nextMonth')}
                icon={<ChevronLeft aria-hidden />}
                onClick={() => setMonth(shiftJalaliMonth(month.jy, month.jm, 1))}
              />
            </div>
            {error && !data ? (
              <CalendarError error={error} />
            ) : isPending && !data ? (
              <Skeleton className="h-96 rounded-xl" />
            ) : (
              <CalendarMonth
                cells={cells}
                selected={selected}
                onSelect={(date) => {
                  setSelected(date);
                  // Wide screens show the day beside the month; only phones open a sheet.
                  setSheet(!window.matchMedia('(min-width: 768px)').matches);
                }}
                dayLabel={(cell) => {
                  const day = data?.days.find((d) => d.date === cell.date);
                  const label = cell.items.length
                    ? t('calendar.dayItems', {
                        date: formatCalendarDate(cell.date, 'full'),
                        count: formatNumber(cell.items.length),
                      })
                    : t('calendar.dayNoItems', { date: formatCalendarDate(cell.date, 'full') });
                  const state = day?.holiday
                    ? t('calendar.holiday')
                    : day?.off
                      ? t('calendar.off')
                      : null;
                  return state ? t('calendar.dayWithState', { label, state }) : label;
                }}
              />
            )}
          </CardContent>
        </Card>
        {/* Wide screens: the day beside the month. */}
        <Card className={cn('hidden md:block md:w-80 md:shrink-0')}>
          <CardContent className="flex flex-col gap-2 pt-4">
            {selected && (
              <h2 className="text-sm font-bold text-ink">{dayHeading(selected, today)}</h2>
            )}
            {dayBody}
          </CardContent>
        </Card>
        {/* Phones: the day in a sheet. */}
        <Modal
          open={sheet && selected !== null}
          onOpenChange={setSheet}
          title={selected ? dayHeading(selected, today) : ''}
        >
          <div className="flex flex-col gap-2">{dayBody}</div>
        </Modal>
      </div>
    </DueMovesProvider>
  );
}
