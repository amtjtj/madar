'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReportRef, ReportScope, WeeklyReport } from '@madar/shared';

import { api } from '@/lib/api';

import { reportKeys } from './keys';

const query = (scope: ReportScope, departmentId: string | undefined) =>
  `scope=${scope}${scope === 'department' && departmentId ? `&departmentId=${departmentId}` : ''}`;

export function useReportWeeks(
  scope: ReportScope,
  departmentId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: reportKeys.weeks(scope, departmentId),
    queryFn: () => api<string[]>(`/api/reports/weekly/weeks?${query(scope, departmentId)}`),
    enabled,
  });
}

export function useWeeklyReport(
  scope: ReportScope,
  departmentId: string | undefined,
  week: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: reportKeys.weekly(scope, departmentId, week),
    queryFn: () =>
      api<WeeklyReport>(
        `/api/reports/weekly?${query(scope, departmentId)}${week ? `&week=${week}` : ''}`,
      ),
    enabled,
    retry: false,
  });
}

/** Resolves a stored report's id (from a push notification) to its scope and week. */
export function useReportRef(id: string | null) {
  return useQuery({
    queryKey: reportKeys.ref(id ?? ''),
    queryFn: () => api<ReportRef>(`/api/reports/weekly/${id}/ref`),
    enabled: Boolean(id),
    retry: false,
  });
}
