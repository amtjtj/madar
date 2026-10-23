'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  addDays,
  AGENDA_STEP_DAYS,
  type CalendarLayer,
  type CalendarPerson,
  type CalendarRange,
  type Task,
} from '@madar/shared';

import { api, ApiClientError } from '@/lib/api';
import { moveDueInRange } from '@/lib/calendar';

import { calendarKeys, workKeys } from './keys';

function fetchRange(from: string, to: string, layers: CalendarLayer[], member?: string) {
  const params = new URLSearchParams({ from, to, layers: layers.join(',') });
  if (member) params.set('member', member);
  return api<CalendarRange>(`/api/calendar?${params.toString()}`);
}

/** One range (week, day or month view); someone else's with `member`. */
export function useCalendarRange(
  from: string,
  to: string,
  layers: CalendarLayer[],
  member?: string,
) {
  return useQuery({
    queryKey: calendarKeys.range(from, to, layers, member),
    queryFn: () => fetchRange(from, to, layers, member),
    placeholderData: (previous) => previous,
  });
}

/** The agenda: from today, fourteen days at a time. */
export function useAgenda(today: string, layers: CalendarLayer[], member?: string) {
  return useInfiniteQuery({
    queryKey: calendarKeys.agenda(today, layers, member),
    initialPageParam: today,
    queryFn: ({ pageParam }) =>
      fetchRange(pageParam, addDays(pageParam, AGENDA_STEP_DAYS - 1), layers, member),
    getNextPageParam: (_last, pages) => addDays(today, pages.length * AGENDA_STEP_DAYS),
  });
}

/** Whose calendar the viewer may open, themselves first (plan phase-2-step-14b). */
export function useCalendarPeople() {
  return useQuery({
    queryKey: calendarKeys.people,
    queryFn: () => api<CalendarPerson[]>('/api/calendar/people'),
    staleTime: 5 * 60_000,
  });
}

type CalendarData = CalendarRange | InfiniteData<CalendarRange>;

/**
 * Move a task's due date from the calendar: the same `PATCH /api/tasks/:id` as the task page, shown
 * at once in every cached calendar range and rolled back on error.
 */
export function useMoveDue(today: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, dueOn }: { id: string; version: number; dueOn: string }) =>
      api<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: { version, dueOn } }),
    onMutate: async ({ id, dueOn }) => {
      await client.cancelQueries({ queryKey: calendarKeys.all });
      const snap = client.getQueriesData<CalendarData>({ queryKey: calendarKeys.all });
      client.setQueriesData<CalendarData>({ queryKey: calendarKeys.all }, (data) => {
        if (!data || !('days' in data || 'pages' in data)) return data;
        if ('pages' in data) {
          return { ...data, pages: data.pages.map((p) => moveDueInRange(p, id, dueOn, today)) };
        }
        return moveDueInRange(data, id, dueOn, today);
      });
      return snap;
    },
    onError: (_error, _vars, snap) => {
      for (const [key, data] of snap ?? []) client.setQueryData(key, data);
    },
    onSettled: (_task, error) => {
      void client.invalidateQueries({ queryKey: calendarKeys.all });
      if (!error || (error instanceof ApiClientError && error.code === 'version_conflict')) {
        void client.invalidateQueries({ queryKey: workKeys.allTasks });
        void client.invalidateQueries({ queryKey: workKeys.today });
      }
    },
  });
}
