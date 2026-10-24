'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  XP_PAGE,
  type GamificationSettings,
  type Task,
  type MyProgress,
  type StreakDay,
  type XpEntry,
} from '@madar/shared';

import { api } from '@/lib/api';
import { xpForFinishing } from '@/lib/progress';

import { progressKeys } from './keys';
import { useMe } from './use-me';

/** My level, XP, streak and today's ring (ADR 0029). */
export function useMyProgress() {
  return useQuery({
    queryKey: progressKeys.mine,
    queryFn: () => api<MyProgress>('/api/me/progress'),
    staleTime: 30_000,
  });
}

export function useXpHistory() {
  return useInfiniteQuery({
    queryKey: progressKeys.xp,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<XpEntry[]>(`/api/me/xp${pageParam ? `?before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.length === XP_PAGE ? last.at(-1)?.id : undefined),
  });
}

export function useStreakDays(from: string, to: string) {
  return useQuery({
    queryKey: progressKeys.streak(from, to),
    queryFn: () => api<StreakDay[]>(`/api/me/streak?from=${from}&to=${to}`),
  });
}

export function useGamificationSettings() {
  return useQuery({
    queryKey: progressKeys.settings,
    queryFn: () => api<GamificationSettings>('/api/settings/gamification'),
  });
}

export function useSaveGamificationSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: GamificationSettings) =>
      api<GamificationSettings>('/api/settings/gamification', { method: 'PUT', body }),
    onSuccess: (saved) => {
      client.setQueryData(progressKeys.settings, saved);
      void client.invalidateQueries({ queryKey: progressKeys.all });
    },
  });
}

/** The «+XP» to show on a task's check (undefined when none would be earned). */
export function useXpFor() {
  const { data: me } = useMe();
  const { data: progress } = useMyProgress();
  return (task: Pick<Task, 'weight' | 'dueOn' | 'source' | 'assignee'>) =>
    xpForFinishing(task, me?.member?.id, progress);
}
