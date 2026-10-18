'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { NotificationList, NotificationPreferences, WorkCalendarDto } from '@madar/shared';

import { api } from '@/lib/api';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
  preferences: ['notification-preferences'] as const,
  calendar: ['work-calendar'] as const,
};

const PAGE = 30;

export function useNotifications(enabled = true) {
  return useInfiniteQuery({
    queryKey: notificationKeys.list,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<NotificationList>(
        `/api/notifications?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => (last.items.length === PAGE ? last.items.at(-1)?.id : undefined),
    enabled,
  });
}

/** The bell counter. Realtime hints refresh it; a slow poll covers a lost connection. */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: () => api<{ unreadCount: number }>('/api/notifications/unread-count'),
    select: (data) => data.unreadCount,
    refetchInterval: 120_000,
  });
}

type ListData = InfiniteData<NotificationList, string | undefined>;

/** Mark one notification read, optimistically (list and counter). */
export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/api/notifications/${id}/read`, { method: 'POST' }),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: notificationKeys.all });
      const list = client.getQueryData<ListData>(notificationKeys.list);
      const unread = client.getQueryData<{ unreadCount: number }>(notificationKeys.unread);
      const wasUnread = list?.pages.some((p) => p.items.some((n) => n.id === id && !n.readAt));
      const now = new Date().toISOString();
      client.setQueryData<ListData>(notificationKeys.list, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                items: p.items.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: now } : n)),
              })),
            }
          : data,
      );
      if (wasUnread && unread) {
        client.setQueryData(notificationKeys.unread, {
          unreadCount: Math.max(0, unread.unreadCount - 1),
        });
      }
      return { list, unread };
    },
    onError: (_e, _id, snap) => {
      client.setQueryData(notificationKeys.list, snap?.list);
      client.setQueryData(notificationKeys.unread, snap?.unread);
    },
  });
}

export function useMarkAllRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<undefined>('/api/notifications/read-all', { method: 'POST' }),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: notificationKeys.all });
      const list = client.getQueryData<ListData>(notificationKeys.list);
      const unread = client.getQueryData<{ unreadCount: number }>(notificationKeys.unread);
      const now = new Date().toISOString();
      client.setQueryData<ListData>(notificationKeys.list, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p) => ({
                ...p,
                unreadCount: 0,
                items: p.items.map((n) => (n.readAt ? n : { ...n, readAt: now })),
              })),
            }
          : data,
      );
      client.setQueryData(notificationKeys.unread, { unreadCount: 0 });
      return { list, unread };
    },
    onError: (_e, _v, snap) => {
      client.setQueryData(notificationKeys.list, snap?.list);
      client.setQueryData(notificationKeys.unread, snap?.unread);
    },
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: () => api<NotificationPreferences>('/api/me/notification-preferences'),
  });
}

export function useSaveNotificationPreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: NotificationPreferences) =>
      api<NotificationPreferences>('/api/me/notification-preferences', { method: 'PUT', body }),
    onMutate: async (body) => {
      const previous = client.getQueryData(notificationKeys.preferences);
      client.setQueryData(notificationKeys.preferences, body);
      return previous;
    },
    onError: (_e, _b, previous) => client.setQueryData(notificationKeys.preferences, previous),
    onSuccess: (saved) => client.setQueryData(notificationKeys.preferences, saved),
  });
}

export function useWorkCalendar() {
  return useQuery({
    queryKey: notificationKeys.calendar,
    queryFn: () => api<WorkCalendarDto>('/api/work-calendar'),
    staleTime: 5 * 60_000,
  });
}

export function useSaveWorkCalendar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkCalendarDto) =>
      api<WorkCalendarDto>('/api/work-calendar', { method: 'PUT', body }),
    onSuccess: (saved) => client.setQueryData(notificationKeys.calendar, saved),
  });
}
