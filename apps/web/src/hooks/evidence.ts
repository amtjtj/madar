'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Evidence,
  EvidenceAudience,
  EvidenceDetail,
  LetterSummary,
  Task,
} from '@madar/shared';

import { api } from '@/lib/api';

import { evidenceKeys, letterKeys, workKeys } from './keys';

export function useTaskEvidence(taskId: string) {
  return useQuery({
    queryKey: evidenceKeys.task(taskId),
    queryFn: () => api<Evidence[]>(`/api/tasks/${taskId}/evidence`),
  });
}

export function useEvidenceAudience(taskId: string | undefined) {
  return useQuery({
    queryKey: evidenceKeys.audience(taskId ?? ''),
    enabled: Boolean(taskId),
    queryFn: () => api<EvidenceAudience>(`/api/tasks/${taskId}/evidence/audience`),
  });
}

export function useEvidenceCandidates(taskId: string, q: string, enabled: boolean) {
  return useQuery({
    queryKey: evidenceKeys.candidates(taskId, q),
    enabled,
    queryFn: () =>
      api<LetterSummary[]>(
        `/api/tasks/${taskId}/evidence/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
    placeholderData: (previous) => previous,
  });
}

export function useEvidenceDetail(taskId: string, id: string | null) {
  return useQuery({
    queryKey: evidenceKeys.detail(taskId, id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api<EvidenceDetail>(`/api/tasks/${taskId}/evidence/${id}`),
  });
}

/** Tasks the person may edit, for «سنجاق به کار» from a letter. */
export function useEditableTasks(q: string, enabled: boolean) {
  return useQuery({
    queryKey: evidenceKeys.editableTasks(q),
    enabled,
    queryFn: () => {
      const params = new URLSearchParams({ view: 'visible', editable: 'true', status: 'all' });
      if (q) params.set('q', q);
      return api<Task[]>(`/api/tasks?${params.toString()}`);
    },
    placeholderData: (previous) => previous,
  });
}

function refresh(client: ReturnType<typeof useQueryClient>, taskId: string) {
  void client.invalidateQueries({ queryKey: evidenceKeys.task(taskId) });
  void client.invalidateQueries({ queryKey: workKeys.task(taskId), exact: true });
  void client.invalidateQueries({ queryKey: workKeys.activity(taskId) });
  void client.invalidateQueries({ queryKey: workKeys.allTasks });
  void client.invalidateQueries({ queryKey: letterKeys.all });
}

export function usePinEvidence() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, letterId }: { taskId: string; letterId: string }) =>
      api<Evidence>(`/api/tasks/${taskId}/evidence`, {
        method: 'POST',
        body: { kind: 'letter', subjectId: letterId },
      }),
    onSettled: (_data, _error, { taskId }) => refresh(client, taskId),
  });
}

/** Unpin, optimistically. */
export function useUnpinEvidence(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`/api/tasks/${taskId}/evidence/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: evidenceKeys.task(taskId) });
      const before = client.getQueryData<Evidence[]>(evidenceKeys.task(taskId));
      client.setQueryData<Evidence[]>(evidenceKeys.task(taskId), (list) =>
        list?.filter((e) => e.id !== id),
      );
      return { before };
    },
    onError: (_e, _id, context) => client.setQueryData(evidenceKeys.task(taskId), context?.before),
    onSettled: () => refresh(client, taskId),
  });
}
