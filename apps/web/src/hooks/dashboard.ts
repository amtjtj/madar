'use client';

import { useQuery } from '@tanstack/react-query';
import type { CompanyDashboard, DepartmentDashboard } from '@madar/shared';

import { api } from '@/lib/api';

import { dashboardKeys } from './keys';

export function useCompanyDashboard(enabled: boolean) {
  return useQuery({
    queryKey: dashboardKeys.company,
    queryFn: () => api<CompanyDashboard>('/api/dashboard/company'),
    enabled,
    staleTime: 60_000,
  });
}

export function useDepartmentDashboard(departmentId: string | undefined) {
  return useQuery({
    queryKey: dashboardKeys.department(departmentId ?? ''),
    queryFn: () => api<DepartmentDashboard>(`/api/dashboard/departments/${departmentId}`),
    enabled: Boolean(departmentId),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}
