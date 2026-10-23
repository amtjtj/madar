'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiSettings,
  AiStatus,
  AskResponse,
  KnowledgeIndexStatus,
  ReportScope,
  ReportSummary,
  TaskBreakdownResponse,
} from '@madar/shared';

import { api } from '@/lib/api';

import { aiKeys, workKeys } from './keys';

/** Whether this server has the assistant and the company turned it on. */
export function useAiStatus() {
  return useQuery({
    queryKey: aiKeys.status,
    queryFn: () => api<AiStatus>('/api/ai/status'),
    staleTime: 5 * 60_000,
  });
}

/** Admins: whether the service and its model answer right now. */
export function useAiHealth(enabled: boolean) {
  return useQuery({
    queryKey: ['ai', 'health'],
    queryFn: () => api<{ reachable: boolean; modelReachable: boolean }>('/api/ai/health'),
    enabled,
    staleTime: 30_000,
  });
}

export function useSaveAiSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: AiSettings) => api<AiSettings>('/api/settings/ai', { method: 'PUT', body }),
    // Optimistic: the switch moves at once and goes back if the server refuses.
    onMutate: async (body) => {
      await client.cancelQueries({ queryKey: aiKeys.status });
      const previous = client.getQueryData<AiStatus>(aiKeys.status);
      if (previous) client.setQueryData<AiStatus>(aiKeys.status, { ...previous, ...body });
      return previous;
    },
    onError: (_error, _body, previous) => {
      if (previous) client.setQueryData(aiKeys.status, previous);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: ['ai'] }),
  });
}

/** «جمله به کار»: suggestions only; `signal` cancels a slow model. */
export function useTaskBreakdown() {
  return useMutation({
    mutationFn: ({
      sentence,
      departmentId,
      signal,
    }: {
      sentence: string;
      departmentId: string;
      signal: AbortSignal;
    }) =>
      api<TaskBreakdownResponse>('/api/ai/task-breakdown', {
        method: 'POST',
        body: { sentence, departmentId },
        signal,
      }),
  });
}

/** Makes the confirmed suggestions with the ordinary task endpoint, one by one. */
export function useCreateSuggested() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (
      tasks: Array<{
        title: string;
        dueOn: string | null;
        departmentId: string;
        assigneeId: string | null;
      }>,
    ) => {
      let done = 0;
      try {
        for (const task of tasks) {
          await api('/api/tasks', { method: 'POST', body: task });
          done++;
        }
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { done });
      }
      return done;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: workKeys.allTasks });
      void client.invalidateQueries({ queryKey: workKeys.today });
    },
  });
}

/** The assistant's summary of a stored weekly report. */
export function useReportSummary(
  scope: ReportScope,
  departmentId: string | undefined,
  week: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: aiKeys.summary(scope, departmentId, week),
    queryFn: () => {
      const params = new URLSearchParams({ scope });
      if (departmentId) params.set('departmentId', departmentId);
      if (week) params.set('week', week);
      return api<ReportSummary>(`/api/reports/weekly/summary?${params.toString()}`);
    },
    enabled,
  });
}

/** «از مدار بپرس»: an answer from what I may see; `signal` cancels a slow model. */
export function useAsk() {
  return useMutation({
    mutationFn: ({ question, signal }: { question: string; signal: AbortSignal }) =>
      api<AskResponse>('/api/ai/ask', { method: 'POST', body: { question }, signal }),
  });
}

/** Admins: what the knowledge index holds and how much is still waiting (refreshed while it fills). */
export function useKnowledgeIndex(enabled: boolean) {
  return useQuery({
    queryKey: aiKeys.index,
    queryFn: () => api<KnowledgeIndexStatus>('/api/ai/index-status'),
    enabled,
    refetchInterval: (query) => ((query.state.data?.pending ?? 0) > 0 ? 15_000 : false),
  });
}
