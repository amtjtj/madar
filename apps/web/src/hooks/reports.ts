'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReportScope, WeeklyReport } from '@madar/shared';

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
