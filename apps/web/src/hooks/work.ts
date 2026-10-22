'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  Activity,
  SetTaskProgressRequest,
  Comment,
  CreateProjectRequest,
  CreateTaskRequest,
  ListTasksQuery,
  MoveTaskRequest,
  PriorityWeights,
  Project,
  SetProjectMembersRequest,
  Task,
  Today,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from '@madar/shared';
import { calendarDateIn, categoryOf } from '@madar/shared';

import { api, ApiClientError } from '@/lib/api';

import { workKeys } from './keys';
import { useMe } from './use-me';

export function useTasks(params: Partial<ListTasksQuery>, options: { enabled?: boolean } = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return useQuery({
    queryKey: workKeys.tasks(params),
    queryFn: () => api<Task[]>(`/api/tasks?${search.toString()}`),
    placeholderData: (previous) => previous,
    enabled: options.enabled,
  });
}

export function useTask(id: string) {
  return useQuery({ queryKey: workKeys.task(id), queryFn: () => api<Task>(`/api/tasks/${id}`) });
}

export function useComments(taskId: string) {
  return useQuery({
    queryKey: workKeys.comments(taskId),
    queryFn: () => api<Comment[]>(`/api/tasks/${taskId}/comments`),
  });
}

export function useActivity(taskId: string) {
  return useQuery({
    queryKey: workKeys.activity(taskId),
    queryFn: () => api<Activity[]>(`/api/tasks/${taskId}/activity`),
  });
}

export function useProjects(filter: { risk?: boolean } = {}) {
  return useQuery({
    queryKey: filter.risk ? [...workKeys.projects, 'risk'] : workKeys.projects,
    queryFn: () => api<Project[]>(filter.risk ? '/api/projects?risk=true' : '/api/projects'),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: workKeys.project(id),
    queryFn: () => api<Project>(`/api/projects/${id}`),
  });
}

export function useToday() {
  return useQuery({
    queryKey: workKeys.today,
    queryFn: () => api<Today>('/api/today'),
    // The plan follows the day: refresh when the user comes back to the tab.
    refetchOnWindowFocus: true,
  });
}

/** Every cached copy of a task (today, lists, detail) gets the same patch. */
function patchTaskEverywhere(client: QueryClient, id: string, patch: (task: Task) => Task) {
  client.setQueryData<Today>(workKeys.today, (today) => {
    if (!today) return today;
    const items = today.items.map((t) => (t.id === id ? patch(t) : t));
    return {
      ...today,
      items,
      progress: {
        done: items.filter((t) => t.statusCategory === 'done').length,
        total: items.length,
      },
      suggestions: today.suggestions.map((s) =>
        s.task.id === id ? { ...s, task: patch(s.task) } : s,
      ),
    };
  });
  client.setQueriesData<Task[]>({ queryKey: workKeys.allTasks }, (list) =>
    list?.map((t) => (t.id === id ? patch(t) : t)),
  );
  client.setQueryData<Task>(workKeys.task(id), (task) => (task ? patch(task) : task));
}

function snapshot(client: QueryClient) {
  return {
    today: client.getQueryData<Today>(workKeys.today),
    lists: client.getQueriesData<Task[]>({ queryKey: workKeys.allTasks }),
  };
}

function restore(client: QueryClient, snap: ReturnType<typeof snapshot> | undefined) {
  if (!snap) return;
  client.setQueryData(workKeys.today, snap.today);
  for (const [key, data] of snap.lists) client.setQueryData(key, data);
}

function invalidateWork(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: workKeys.today }),
    client.invalidateQueries({ queryKey: workKeys.allTasks }),
  ]);
}

/** Edit a task optimistically; a version conflict refetches instead of overwriting. */
export function useUpdateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateTaskRequest & { id: string }) =>
      api<Task>(`/api/tasks/${id}`, { method: 'PATCH', body }),
    onMutate: async ({ id, version: _version, ...changes }) => {
      await client.cancelQueries({ queryKey: workKeys.today });
      await client.cancelQueries({ queryKey: workKeys.allTasks });
      const snap = snapshot(client);
      patchTaskEverywhere(client, id, (task) => ({
        ...task,
        ...(changes.title !== undefined && { title: changes.title }),
        ...(changes.priority !== undefined && { priority: changes.priority }),
        ...(changes.dueOn !== undefined && { dueOn: changes.dueOn }),
        ...(changes.statusKey !== undefined && {
          statusKey: changes.statusKey,
          statusCategory: categoryOf(changes.statusKey) ?? task.statusCategory,
        }),
      }));
      return snap;
    },
    onError: (error, _vars, snap) => {
      restore(client, snap);
      if (error instanceof ApiClientError && error.code === 'version_conflict') {
        void invalidateWork(client);
      }
    },
    onSuccess: (task) => {
      patchTaskEverywhere(client, task.id, () => task);
      client.setQueryData(workKeys.task(task.id), task);
      void client.invalidateQueries({ queryKey: workKeys.activity(task.id) });
      // A subtask's status or weight moves its parent's computed progress.
      if (task.parentId) void client.invalidateQueries({ queryKey: workKeys.task(task.parentId) });
      void client.invalidateQueries({ queryKey: workKeys.allTasks });
      void client.invalidateQueries({ queryKey: workKeys.projects });
    },
  });
}

/** Record progress (ADR 0018): optimistic, rolled back on error; a parent follows its subtasks. */
export function useSetTaskProgress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SetTaskProgressRequest & { id: string }) =>
      api<Task>(`/api/tasks/${id}/progress`, { method: 'POST', body }),
    onMutate: async ({ id, value }) => {
      await client.cancelQueries({ queryKey: workKeys.today });
      await client.cancelQueries({ queryKey: workKeys.allTasks });
      const snap = snapshot(client);
      patchTaskEverywhere(client, id, (task) => ({
        ...task,
        progress: value,
        ...(value > 0 && task.statusCategory === 'todo'
          ? { statusKey: 'in_progress', statusCategory: 'in_progress' as const }
          : {}),
      }));
      return snap;
    },
    onError: (error, _vars, snap) => {
      restore(client, snap);
      if (error instanceof ApiClientError && error.code === 'version_conflict') {
        void invalidateWork(client);
      }
    },
    onSuccess: (task) => {
      patchTaskEverywhere(client, task.id, () => task);
      client.setQueryData(workKeys.task(task.id), task);
      void client.invalidateQueries({ queryKey: workKeys.activity(task.id) });
      if (task.parentId) void client.invalidateQueries({ queryKey: workKeys.task(task.parentId) });
      void client.invalidateQueries({ queryKey: workKeys.allTasks });
      void client.invalidateQueries({ queryKey: workKeys.projects });
    },
  });
}

/** Toggle done ⇄ to-do for a task (the check circle). */
export function useToggleDone() {
  const update = useUpdateTask();
  return {
    ...update,
    toggle: (task: Task, done: boolean) =>
      update.mutateAsync({ id: task.id, version: task.version, statusKey: done ? 'done' : 'todo' }),
  };
}

/** Placeholder shown while a quick-added task is being saved. */
function draftTask(id: string, body: CreateTaskRequest): Task {
  const now = new Date().toISOString();
  return {
    id,
    title: body.title,
    description: body.description ?? null,
    department: { id: '', name: '' },
    project: null,
    parentId: body.parentId ?? null,
    statusKey: 'todo',
    statusCategory: 'todo',
    priority: body.priority ?? 'normal',
    assignee: null,
    reporter: { id: '', displayName: '' },
    collaborators: [],
    dueOn: body.dueOn ?? null,
    completedAt: null,
    weight: 1,
    sortKey: 'zz',
    version: 0,
    subtasks: { total: 0, done: 0 },
    progress: 0,
    progressMode: 'auto',
    commentCount: 0,
    attachmentCount: 0,
    evidenceCount: 0,
    keyResult: null,
    meeting: null,
    // The server decides source and rank; the placeholder shows neither.
    source: null,
    rank: { score: 0, reasons: [] },
    createdAt: now,
    updatedAt: now,
    can: { edit: false, setWeight: false, delete: false },
  };
}

export const isDraft = (task: Task) => task.id.startsWith('draft-');

export function useCreateTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskRequest) => api<Task>('/api/tasks', { method: 'POST', body }),
    onMutate: async (body) => {
      if (!body.addToToday) return undefined;
      await client.cancelQueries({ queryKey: workKeys.today });
      const draftId = `draft-${Date.now()}`;
      client.setQueryData<Today>(workKeys.today, (today) =>
        today
          ? {
              ...today,
              items: [...today.items, draftTask(draftId, body)],
              progress: { ...today.progress, total: today.progress.total + 1 },
            }
          : today,
      );
      return draftId;
    },
    onError: (_error, _body, draftId) => {
      if (!draftId) return;
      client.setQueryData<Today>(workKeys.today, (today) =>
        today
          ? {
              ...today,
              items: today.items.filter((t) => t.id !== draftId),
              progress: { ...today.progress, total: today.progress.total - 1 },
            }
          : today,
      );
    },
    onSuccess: (task, _body, draftId) => {
      if (draftId) {
        client.setQueryData<Today>(workKeys.today, (today) =>
          today
            ? { ...today, items: today.items.map((t) => (t.id === draftId ? task : t)) }
            : today,
        );
      }
      void client.invalidateQueries({ queryKey: workKeys.allTasks });
    },
  });
}

function planMutation(path: (taskId: string) => string, method: 'POST' | 'DELETE') {
  return function usePlanMutation() {
    const client = useQueryClient();
    return useMutation({
      mutationFn: (taskId: string) => api<Today>(path(taskId), { method }),
      onMutate: async (taskId) => {
        await client.cancelQueries({ queryKey: workKeys.today });
        const previous = client.getQueryData<Today>(workKeys.today);
        if (previous) {
          const items =
            method === 'POST'
              ? [
                  ...previous.items,
                  ...previous.suggestions.filter((s) => s.task.id === taskId).map((s) => s.task),
                ]
              : previous.items.filter((t) => t.id !== taskId);
          client.setQueryData<Today>(workKeys.today, {
            ...previous,
            items,
            suggestions: previous.suggestions.filter((s) => s.task.id !== taskId),
            progress: {
              done: items.filter((t) => t.statusCategory === 'done').length,
              total: items.length,
            },
          });
        }
        return previous;
      },
      onError: (_error, _taskId, previous) => client.setQueryData(workKeys.today, previous),
      onSuccess: (today) => client.setQueryData(workKeys.today, today),
    });
  };
}

export const useAddToToday = planMutation((id) => `/api/today/items/${id}`, 'POST');

/** Today in the member's own order (drag and drop); the list moves at once. */
export function useReorderToday() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (taskIds: string[]) =>
      api<Today>('/api/today/items', { method: 'PUT', body: { taskIds } }),
    onMutate: async (taskIds) => {
      await client.cancelQueries({ queryKey: workKeys.today });
      const previous = client.getQueryData<Today>(workKeys.today);
      if (previous) {
        const byId = new Map(previous.items.map((t) => [t.id, t]));
        const items = taskIds.flatMap((id) => byId.get(id) ?? []);
        client.setQueryData<Today>(workKeys.today, { ...previous, items, ordered: true });
      }
      return previous;
    },
    onError: (_error, _ids, previous) => client.setQueryData(workKeys.today, previous),
    onSuccess: (today) => client.setQueryData(workKeys.today, today),
  });
}

/** Back to the automatic (priority) order for today. */
export function useAutoOrderToday() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<Today>('/api/today/auto-order', { method: 'POST' }),
    onSuccess: (today) => client.setQueryData(workKeys.today, today),
  });
}

/** Ids in the member's own order of «my tasks»; empty while it follows priority. */
export function useTaskOrder() {
  return useQuery({
    queryKey: workKeys.taskOrder,
    queryFn: () => api<{ taskIds: string[] }>('/api/me/task-order'),
  });
}

/** Save the member's own order of «my tasks»; the list moves at once. */
export function useSetTaskOrder(listKey: readonly unknown[]) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (taskIds: string[]) =>
      api<{ taskIds: string[] }>('/api/me/task-order', { method: 'PUT', body: { taskIds } }),
    onMutate: async (taskIds) => {
      await client.cancelQueries({ queryKey: listKey });
      const previous = client.getQueryData<Task[]>(listKey);
      if (previous) {
        const byId = new Map(previous.map((t) => [t.id, t]));
        const moved = taskIds.flatMap((id) => byId.get(id) ?? []);
        const rest = previous.filter((t) => !taskIds.includes(t.id));
        client.setQueryData<Task[]>(listKey, [...moved, ...rest]);
      }
      return previous;
    },
    onError: (_error, _ids, previous) => client.setQueryData(listKey, previous),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: workKeys.taskOrder });
      void client.invalidateQueries({ queryKey: workKeys.allTasks });
    },
  });
}

/** Back to the automatic (priority) order for «my tasks». */
export function useClearTaskOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<undefined>('/api/me/task-order', { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: workKeys.taskOrder });
      void client.invalidateQueries({ queryKey: workKeys.allTasks });
    },
  });
}

/** The company's priority weights (everyone reads them; the owner changes them). */
export function usePriorityWeights() {
  return useQuery({
    queryKey: workKeys.priorityWeights,
    queryFn: () => api<PriorityWeights>('/api/settings/priority'),
  });
}

export function useSavePriorityWeights() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PriorityWeights) =>
      api<PriorityWeights>('/api/settings/priority', { method: 'PUT', body }),
    onSuccess: (weights) => {
      client.setQueryData(workKeys.priorityWeights, weights);
      void client.invalidateQueries({ queryKey: workKeys.allTasks });
      void client.invalidateQueries({ queryKey: workKeys.today });
    },
  });
}
export const useRemoveFromToday = planMutation((id) => `/api/today/items/${id}`, 'DELETE');

/** Board drag and drop: the card moves at once; the server assigns the final position. */
export function useMoveTask(listKey: readonly unknown[]) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: MoveTaskRequest & { id: string; optimistic: Task[] }) =>
      api<Task>(`/api/tasks/${id}/move`, {
        method: 'POST',
        body: {
          statusKey: body.statusKey,
          afterTaskId: body.afterTaskId,
          beforeTaskId: body.beforeTaskId,
        },
      }),
    onMutate: async ({ optimistic }) => {
      await client.cancelQueries({ queryKey: listKey });
      const previous = client.getQueryData<Task[]>(listKey);
      client.setQueryData(listKey, optimistic);
      return previous;
    },
    onError: (_error, _vars, previous) => client.setQueryData(listKey, previous),
    onSuccess: (task) => {
      client.setQueryData<Task[]>(listKey, (list) =>
        list?.map((t) => (t.id === task.id ? task : t)),
      );
      client.setQueryData(workKeys.task(task.id), task);
      void client.invalidateQueries({ queryKey: workKeys.today });
      // Project progress counts done tasks.
      void client.invalidateQueries({ queryKey: workKeys.projects });
    },
  });
}

export function useDeleteTask() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/api/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateWork(client),
  });
}

export function useAddComment(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; attachmentIds?: string[] }) =>
      api<Comment>(`/api/tasks/${taskId}/comments`, { method: 'POST', body: input }),
    onSuccess: (comment) => {
      client.setQueryData<Comment[]>(workKeys.comments(taskId), (list) => [
        ...(list ?? []),
        comment,
      ]);
      void client.invalidateQueries({ queryKey: workKeys.task(taskId), exact: true });
      if (comment.attachments.length) {
        void client.invalidateQueries({ queryKey: ['task', taskId, 'attachments'] });
      }
    },
  });
}

export function useEditComment(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string | null }): Promise<undefined> => {
      if (body === null) await api<undefined>(`/api/comments/${id}`, { method: 'DELETE' });
      else await api<Comment>(`/api/comments/${id}`, { method: 'PATCH', body: { body } });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: workKeys.comments(taskId) });
      void client.invalidateQueries({ queryKey: workKeys.task(taskId), exact: true });
    },
  });
}

function projectMutation<TVars>(request: (vars: TVars) => Promise<unknown>) {
  return function useProjectMutation() {
    const client = useQueryClient();
    return useMutation({
      mutationFn: request,
      onSuccess: () => client.invalidateQueries({ queryKey: workKeys.projects }),
    });
  };
}

export const useCreateProject = projectMutation((body: CreateProjectRequest) =>
  api<Project>('/api/projects', { method: 'POST', body }),
);
export const useUpdateProject = projectMutation(
  ({ id, ...body }: UpdateProjectRequest & { id: string }) =>
    api<Project>(`/api/projects/${id}`, { method: 'PATCH', body }),
);
export const useArchiveProject = projectMutation((id: string) =>
  api<undefined>(`/api/projects/${id}/archive`, { method: 'POST' }),
);
export const useSetProjectMembers = projectMutation(
  ({ id, ...body }: SetProjectMembersRequest & { id: string }) =>
    api<Project>(`/api/projects/${id}/members`, { method: 'PUT', body }),
);

/** Today's calendar date in the tenant time zone. */
export function useTodayDate(): string {
  const { data: me } = useMe();
  return calendarDateIn(new Date(), me?.tenant?.timezone);
}
