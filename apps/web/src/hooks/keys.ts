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
  /** The member's own order of «my tasks» (ADR 0017). */
  taskOrder: ['task-order'] as const,
  priorityWeights: ['settings', 'priority'] as const,
};

/** Attachments (ADR 0019). */
export const fileKeys = {
  task: (taskId: string) => ['task', taskId, 'attachments'] as const,
  settings: ['settings', 'files'] as const,
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

export const dashboardKeys = {
  all: ['dashboard'] as const,
  company: ['dashboard', 'company'] as const,
  department: (id: string) => ['dashboard', 'department', id] as const,
};

export const reportKeys = {
  all: ['reports'] as const,
  weekly: (scope: string, departmentId: string | undefined, week: string | undefined) =>
    ['reports', 'weekly', scope, departmentId ?? null, week ?? null] as const,
  weeks: (scope: string, departmentId: string | undefined) =>
    ['reports', 'weeks', scope, departmentId ?? null] as const,
  ref: (id: string) => ['reports', 'ref', id] as const,
};

/** Internal letters (ADR 0020). */
export const letterKeys = {
  all: ['letters'] as const,
  list: (folder: string, q: string) => ['letters', 'list', folder, q] as const,
  unread: ['letters', 'unread'] as const,
  letter: (id: string) => ['letters', 'detail', id] as const,
};

/** «شاهد کار» (ADR 0021); under ['task', id] so realtime work hints refresh it. */
export const evidenceKeys = {
  task: (taskId: string) => ['task', taskId, 'evidence'] as const,
  audience: (taskId: string) => ['task', taskId, 'evidence', 'audience'] as const,
  candidates: (taskId: string, q: string) => ['task', taskId, 'evidence', 'candidates', q] as const,
  detail: (taskId: string, id: string) => ['task', taskId, 'evidence', 'detail', id] as const,
  editableTasks: (q: string) => ['tasks', 'editable', q] as const,
};

/** Internal chat (ADR 0022). */
export const chatKeys = {
  all: ['chat'] as const,
  list: ['chat', 'list'] as const,
  unread: ['chat', 'unread'] as const,
  conversation: (id: string) => ['chat', 'conversation', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
  byProject: (projectId: string) => ['chat', 'by-project', projectId] as const,
  messageTasks: (messageId: string) => ['chat', 'message-tasks', messageId] as const,
  search: (q: string, conversationId?: string) =>
    ['chat', 'search', q, conversationId ?? null] as const,
  around: (id: string, messageId: string) => ['chat', 'around', id, messageId] as const,
  exports: ['chat', 'exports'] as const,
};

/** Meetings (ADR 0023). */
export const meetingKeys = {
  all: ['meetings'] as const,
  list: (range: string) => ['meetings', 'list', range] as const,
  today: ['meetings', 'today'] as const,
  meeting: (id: string) => ['meetings', 'detail', id] as const,
};

/** The personal calendar (ADR 0024). */
export const calendarKeys = {
  all: ['calendar'] as const,
  range: (from: string, to: string, layers: string[], member = '') =>
    ['calendar', 'range', from, to, layers.join(','), member] as const,
  agenda: (today: string, layers: string[], member = '') =>
    ['calendar', 'agenda', today, layers.join(','), member] as const,
  people: ['calendar', 'people'] as const,
};

/** The assistant (ADR 0025). */
export const aiKeys = {
  status: ['ai', 'status'] as const,
  summary: (scope: string, departmentId: string | undefined, week: string | undefined) =>
    ['ai', 'summary', scope, departmentId ?? null, week ?? null] as const,
};
