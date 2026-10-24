'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  allStatuses,
  defaultType,
  typeOf,
  type ApplyTemplateRequest,
  type DepartmentConfig,
  type DepartmentConfigDetail,
  type ModuleConfig,
  type SaveConfigRequest,
  type StatusDef,
  type Task,
  type TemplateSummary,
  type WorkItemTypeDef,
} from '@madar/shared';
import { useCallback } from 'react';

import { api } from '@/lib/api';

import { configKeys, workKeys } from './keys';

/**
 * Department configs (plan phase-3-step-19a): every active department's statuses, work types and
 * fields, fetched once and kept fresh by the `module_config.changed` hint.
 */
export function useModuleConfigs() {
  return useQuery({
    queryKey: configKeys.all,
    queryFn: () => api<DepartmentConfig[]>('/api/module-configs'),
    staleTime: 5 * 60_000,
  });
}

export function useDepartmentConfig(departmentId: string | null | undefined): ModuleConfig | null {
  const { data } = useModuleConfigs();
  return data?.find((c) => c.departmentId === departmentId)?.config ?? null;
}

export interface TaskLook {
  status: StatusDef | null;
  type: WorkItemTypeDef | null;
  /** The department has more than one work type (then the type is worth showing). */
  manyTypes: boolean;
}

/** Status and type of any task as its department names and colours them. */
export function useTaskLook(): (
  task: Pick<Task, 'department' | 'statusKey' | 'typeKey'>,
) => TaskLook {
  const { data } = useModuleConfigs();
  return useCallback(
    (task) => {
      const config = data?.find((c) => c.departmentId === task.department.id)?.config;
      if (!config) return { status: null, type: null, manyTypes: false };
      return {
        status: allStatuses(config).find((s) => s.key === task.statusKey) ?? null,
        type: typeOf(config, task.typeKey) ?? null,
        manyTypes: config.workItemTypes.length > 1,
      };
    },
    [data],
  );
}

export { defaultType };

export function useTemplates() {
  return useQuery({
    queryKey: configKeys.templates,
    queryFn: () => api<TemplateSummary[]>('/api/templates'),
    staleTime: Infinity,
  });
}

export function useConfigDetail(departmentId: string) {
  return useQuery({
    queryKey: configKeys.detail(departmentId),
    queryFn: () => api<DepartmentConfigDetail>(`/api/departments/${departmentId}/config`),
  });
}

function useAfterConfigChange() {
  const client = useQueryClient();
  return (detail: DepartmentConfigDetail) => {
    client.setQueryData(configKeys.detail(detail.departmentId), detail);
    void client.invalidateQueries({ queryKey: configKeys.all });
    void client.invalidateQueries({ queryKey: workKeys.allTasks });
    void client.invalidateQueries({ queryKey: ['task'] });
  };
}

export function useSaveConfig(departmentId: string) {
  const after = useAfterConfigChange();
  return useMutation({
    mutationFn: (body: SaveConfigRequest) =>
      api<DepartmentConfigDetail>(`/api/departments/${departmentId}/config`, {
        method: 'PUT',
        body,
      }),
    onSuccess: after,
  });
}

export function useApplyTemplate(departmentId: string) {
  const after = useAfterConfigChange();
  return useMutation({
    mutationFn: (body: ApplyTemplateRequest) =>
      api<DepartmentConfigDetail>(`/api/departments/${departmentId}/apply-template`, {
        method: 'POST',
        body,
      }),
    onSuccess: after,
  });
}
