'use client';

import type { ReactNode } from 'react';

import { calendarDateIn, layoutOverlaps, timeGridSpan, type CalendarDay } from '@madar/shared';
import { TimedEvent, WeekGrid, type WeekGridDay, type WeekGridEvent } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { itemHref, itemTime, itemTitle } from '@/lib/calendar';
import { wallClock } from '@/lib/meetings';

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Days as `WeekGrid` columns: meetings in the hour grid, everything else in `allDay`. */
export function TimeGrid({
  days,
  today,
  timeZone,
  allDay,
  dayLabel,
}: {
  days: CalendarDay[];
  today: string;
  timeZone?: string;
  allDay?: (day: CalendarDay) => ReactNode;
  dayLabel: (day: CalendarDay) => string;
}) {
  const timed = days.flatMap((day) =>
    day.items.flatMap((item) => {
      if (!item.meeting) return [];
      const startsAt = new Date(item.meeting.startsAt);
      const endsAt = new Date(item.meeting.endsAt);
      const start = minutes(wallClock(startsAt, timeZone));
      // A meeting past midnight stays on the day it starts, to the end of that day.
      const end =
        calendarDateIn(endsAt, timeZone) === day.date
          ? minutes(wallClock(endsAt, timeZone))
          : 24 * 60;
      return [{ id: `${day.date}|${item.id}`, date: day.date, start, end, item }];
    }),
  );
  const layout = new Map<string, { column: number; columns: number }>();
  for (const day of days) {
    for (const [id, place] of layoutOverlaps(timed.filter((e) => e.date === day.date))) {
      layout.set(id, place);
    }
  }
  const events: WeekGridEvent[] = timed.map((e) => ({
    id: e.id,
    date: e.date,
    start: e.start,
    end: e.end,
    ...(layout.get(e.id) ?? { column: 0, columns: 1 }),
    node: (
      <TimedEvent
        title={itemTitle(e.item)}
        time={itemTime(e.item, timeZone) ?? ''}
        href={itemHref(e.item)}
        Link={NextLink}
        struck={e.item.meeting?.canceled}
        faded={e.item.meeting?.myResponse === 'declined'}
      />
    ),
  }));
  const { startHour, endHour } = timeGridSpan(
    days.map((d) => d.hours),
    timed,
  );
  const byDate = new Map(days.map((d) => [d.date, d]));
  const gridDays: WeekGridDay[] = days.map((d) => ({
    date: d.date,
    today: d.date === today,
    off: d.off || d.holiday,
  }));
  const pick = (day: WeekGridDay) => byDate.get(day.date) as CalendarDay;
  return (
    <WeekGrid
      days={gridDays}
      startHour={startHour}
      endHour={endHour}
      events={events}
      nowMinutes={minutes(wallClock(new Date(), timeZone))}
      allDay={allDay && ((day) => allDay(pick(day)))}
      dayLabel={(day) => dayLabel(pick(day))}
    />
  );
}
