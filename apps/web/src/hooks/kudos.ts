'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KUDOS_PAGE,
  type GiveKudosRequest,
  type KudosAllowance,
  type KudosItem,
  type MemberProfile,
  type MyBadge,
} from '@madar/shared';

import { api } from '@/lib/api';

import { kudosKeys, progressKeys } from './keys';

/** Kudos a member received, or (no member) the company's latest public ones (ADR 0030). */
export function useKudos(member: string | null, limit = KUDOS_PAGE, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...kudosKeys.list(member), limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (member) params.set('member', member);
      if (pageParam) params.set('before', pageParam);
      return api<KudosItem[]>(`/api/kudos?${params.toString()}`);
    },
    getNextPageParam: (last) => (last.length === limit ? last.at(-1)?.id : undefined),
    enabled,
  });
}

export function useKudosAllowance(enabled = true) {
  return useQuery({
    queryKey: kudosKeys.allowance,
    queryFn: () => api<KudosAllowance>('/api/me/kudos-allowance'),
    enabled,
  });
}

export function useGiveKudos() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: GiveKudosRequest) => api<KudosItem>('/api/kudos', { method: 'POST', body }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: kudosKeys.all });
      void client.invalidateQueries({ queryKey: progressKeys.all });
    },
  });
}

/** Hide a thanks from my profile (my lists refetch; colleagues get the realtime hint). */
export function useHideKudos() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/kudos/${id}/hide`, { method: 'POST' }),
    onSettled: () => void client.invalidateQueries({ queryKey: ['kudos', 'list'] }),
  });
}

export function useMyBadges() {
  return useQuery({ queryKey: kudosKeys.badges, queryFn: () => api<MyBadge[]>('/api/me/badges') });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: kudosKeys.profile(id),
    queryFn: () => api<MemberProfile>(`/api/members/${id}/profile`),
  });
}
