'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Checkin,
  CreateCheckinRequest,
  CreateGoalRequest,
  GoalDetail,
  GoalPeriod,
  GoalSummary,
  KeyResult,
  KeyResultOption,
  NewKeyResultRequest,
  UpdateGoalRequest,
} from '@madar/shared';

import { api } from '@/lib/api';

import { goalKeys, workKeys } from './keys';

export type GoalView = 'mine' | 'department' | 'company';

export function useGoalPeriods() {
  return useQuery({
    queryKey: goalKeys.periods,
    queryFn: () => api<GoalPeriod[]>('/api/goal-periods'),
    staleTime: 10 * 60_000,
  });
}

export function useGoals(view: GoalView, periodId: string | undefined) {
  return useQuery({
    queryKey: goalKeys.list(view, periodId),
    queryFn: () =>
      api<GoalSummary[]>(`/api/goals?view=${view}${periodId ? `&periodId=${periodId}` : ''}`),
    enabled: Boolean(periodId),
    placeholderData: (previous) => previous,
  });
}

export function useGoal(id: string) {
  return useQuery({
    queryKey: goalKeys.goal(id),
    queryFn: () => api<GoalDetail>(`/api/goals/${id}`),
  });
}

export function useCheckins(keyResultId: string, enabled: boolean) {
  return useQuery({
    queryKey: goalKeys.checkins(keyResultId),
    queryFn: () => api<Checkin[]>(`/api/key-results/${keyResultId}/check-ins`),
    enabled,
  });
}

export function useKeyResultOptions(enabled: boolean) {
  return useQuery({
    queryKey: goalKeys.options(''),
    queryFn: () => api<KeyResultOption[]>('/api/key-results'),
    enabled,
    staleTime: 60_000,
  });
}

/** Every goal view and detail: progress moves up the chain, so all of them may change. */
function useInvalidateGoals() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: goalKeys.all });
}

export function useCreateGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (body: CreateGoalRequest) =>
      api<GoalDetail>('/api/goals', { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateGoal(id: string) {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (body: UpdateGoalRequest) =>
      api<GoalDetail>(`/api/goals/${id}`, { method: 'PATCH', body }),
    onSuccess: () => invalidate(),
  });
}

export function useArchiveGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/api/goals/${id}/archive`, { method: 'POST' }),
    onSuccess: () => invalidate(),
  });
}

export function useAddKeyResult(goalId: string) {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (body: NewKeyResultRequest) =>
      api<KeyResult>(`/api/goals/${goalId}/key-results`, { method: 'POST', body }),
    onSuccess: () => invalidate(),
  });
}

/** Records a check-in; the key result moves at once, the goal chain after the refetch. */
export function useCheckIn(goalId: string) {
  const client = useQueryClient();
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({ keyResultId, ...body }: CreateCheckinRequest & { keyResultId: string }) =>
      api<Checkin>(`/api/key-results/${keyResultId}/check-ins`, { method: 'POST', body }),
    onMutate: async ({ keyResultId, value, status }) => {
      await client.cancelQueries({ queryKey: goalKeys.goal(goalId) });
      client.setQueryData<GoalDetail>(goalKeys.goal(goalId), (goal) =>
        goal
          ? {
              ...goal,
              keyResults: goal.keyResults.map((kr) =>
                kr.id === keyResultId ? { ...kr, currentValue: value, status } : kr,
              ),
            }
          : goal,
      );
    },
    onSettled: () => invalidate(),
  });
}

/** Links a task or project to a key result (or clears it). */
export function useLinkKeyResult() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      target:
        | { kind: 'task'; id: string; version: number; keyResultId: string | null }
        | { kind: 'project'; id: string; keyResultId: string | null },
    ) =>
      target.kind === 'task'
        ? api(`/api/tasks/${target.id}`, {
            method: 'PATCH',
            body: { version: target.version, keyResultId: target.keyResultId },
          })
        : api(`/api/projects/${target.id}`, {
            method: 'PATCH',
            body: { keyResultId: target.keyResultId },
          }),
    onSuccess: (_data, target) => {
      void client.invalidateQueries({
        queryKey: target.kind === 'task' ? workKeys.task(target.id) : workKeys.project(target.id),
      });
      void client.invalidateQueries({ queryKey: goalKeys.all });
    },
  });
}
