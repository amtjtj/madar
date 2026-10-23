import type { MeResponse } from '@madar/shared';

type MeMember = NonNullable<MeResponse['member']>;

/**
 * The company's leadership in the UI (plan phase-3-step-17a): owners (all work) and executives
 * (company goals). The API decides with the same rule (`leadsCompany` in `work/access.ts`).
 */
export function leadsCompany(member: MeMember | null | undefined): boolean {
  return (
    member?.permissions['task.manage'] === 'tenant' ||
    member?.permissions['goal.manage'] === 'tenant'
  );
}

/** Departments the member runs as head or manager. */
export function managedDepartments(member: MeMember | null | undefined): string[] {
  return (member?.departments ?? [])
    .filter((d) => d.deptRole === 'head' || d.deptRole === 'manager')
    .map((d) => d.id);
}
