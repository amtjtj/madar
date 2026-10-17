'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreateTaskRequest,
  ListTasksQuery,
  Task,
  Today,
  UpdateTaskRequest,
} from '@madar/shared';

import { api, ApiClientError } from '@/lib/api';

export const workKeys = {
  today: ['today'] as const,
  tasks: (params: Partial<ListTasksQuery> = {}) => ['tasks', params] as const,
  allTasks: ['tasks'] as const,
  task: (id: string) => ['task', id] as const,
};

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
          statusCategory:
            changes.statusKey === 'done'
              ? 'done'
              : task.statusCategory === 'done'
                ? 'todo'
                : task.statusCategory,
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
    commentCount: 0,
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
export const useRemoveFromToday = planMutation((id) => `/api/today/items/${id}`, 'DELETE');
