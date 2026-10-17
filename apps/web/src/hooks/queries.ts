'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { AuditLogEntry, Department, Member, OrgChartNode, Permission } from '@madar/shared';

import { api } from '@/lib/api';

import { useMe } from './use-me';

export const keys = {
  departments: ['departments'] as const,
  members: (params: object = {}) => ['members', params] as const,
  orgChart: ['org-chart'] as const,
  audit: ['audit'] as const,
};

export function useDepartments() {
  return useQuery({
    queryKey: keys.departments,
    queryFn: () => api<Department[]>('/api/departments'),
  });
}

export function useMembers(params: { q?: string; includeInactive?: boolean } = {}) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.includeInactive) search.set('includeInactive', 'true');
  const qs = search.toString();
  return useQuery({
    queryKey: keys.members(params),
    queryFn: () => api<Member[]>(`/api/members${qs ? `?${qs}` : ''}`),
    placeholderData: (previous) => previous,
  });
}

export function useOrgChart() {
  return useQuery({
    queryKey: keys.orgChart,
    queryFn: () => api<OrgChartNode[]>('/api/org-chart'),
  });
}

export function useAuditLog() {
  return useInfiniteQuery({
    queryKey: keys.audit,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      api<AuditLogEntry[]>(`/api/audit-logs?limit=30${pageParam ? `&beforeSeq=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.length === 30 ? last[last.length - 1]?.seq : undefined),
  });
}

/** UI-only permission check (hides controls; the API enforces). */
export function useCan() {
  const { data: me } = useMe();
  const permissions = me?.member?.permissions ?? {};
  return (permission: Permission) => permission in permissions;
}
