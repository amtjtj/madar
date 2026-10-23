'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { addDays, AGENDA_STEP_DAYS, type CalendarLayer, type CalendarRange } from '@madar/shared';

import { api } from '@/lib/api';

import { calendarKeys } from './keys';

function fetchRange(from: string, to: string, layers: CalendarLayer[]) {
  const params = new URLSearchParams({ from, to, layers: layers.join(',') });
  return api<CalendarRange>(`/api/calendar?${params.toString()}`);
}

/** One range (the month view). */
export function useCalendarRange(from: string, to: string, layers: CalendarLayer[]) {
  return useQuery({
    queryKey: calendarKeys.range(from, to, layers),
    queryFn: () => fetchRange(from, to, layers),
    placeholderData: (previous) => previous,
  });
}

/** The agenda: from today, fourteen days at a time. */
export function useAgenda(today: string, layers: CalendarLayer[]) {
  return useInfiniteQuery({
    queryKey: calendarKeys.agenda(today, layers),
    initialPageParam: today,
    queryFn: ({ pageParam }) =>
      fetchRange(pageParam, addDays(pageParam, AGENDA_STEP_DAYS - 1), layers),
    getNextPageParam: (_last, pages) => addDays(today, pages.length * AGENDA_STEP_DAYS),
  });
}
