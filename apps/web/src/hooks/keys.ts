import type { ListTasksQuery } from '@madar/shared';

/** TanStack Query keys (plain module: constants must not live in 'use client' files). */
export const workKeys = {
  today: ['today'] as const,
  tasks: (params: Partial<ListTasksQuery> = {}) => ['tasks', params] as const,
  allTasks: ['tasks'] as const,
  task: (id: string) => ['task', id] as const,
  comments: (taskId: string) => ['task', taskId, 'comments'] as const,
  activity: (taskId: string) => ['task', taskId, 'activity'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
};

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
  preferences: ['notification-preferences'] as const,
  calendar: ['work-calendar'] as const,
};

export const pushKeys = {
  config: ['push-config'] as const,
};

export const goalKeys = {
  all: ['goals'] as const,
  periods: ['goals', 'periods'] as const,
  list: (view: string, periodId: string | undefined) => ['goals', 'list', view, periodId] as const,
  goal: (id: string) => ['goals', 'detail', id] as const,
  checkins: (keyResultId: string) => ['goals', 'checkins', keyResultId] as const,
  options: (q: string) => ['goals', 'kr-options', q] as const,
};
