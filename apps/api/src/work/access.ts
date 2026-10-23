import { schema as s } from '@madar/db';
import { scopeFor, type Actor } from '@madar/shared';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Work access rules (ADR 0005, plan phase-1-step-5 §2). Enforced here, mirrored to the UI as
 * `can` hints. Private projects stay private even from oversight: only their members see them.
 */

export function isDepartmentManager(actor: Actor, departmentId: string): boolean {
  return actor.departments.some(
    (d) => d.id === departmentId && (d.deptRole === 'head' || d.deptRole === 'manager'),
  );
}

export function isDepartmentMember(actor: Actor, departmentId: string): boolean {
  return actor.departments.some((d) => d.id === departmentId);
}

/** Owners (task.manage at tenant scope) manage every task and project. */
export function managesAll(actor: Actor): boolean {
  return scopeFor(actor, 'task.manage') === 'tenant';
}

/** Reads all work and goals: the company dashboard and every weekly report (ADR 0014, 0015). */
export function readsCompany(actor: Actor): boolean {
  return scopeFor(actor, 'task.read') === 'tenant' && scopeFor(actor, 'goal.read') === 'tenant';
}

/** Who may open a weekly report: company readers, and a department's own managers (ADR 0015). */
export function readsReport(actor: Actor, departmentId: string | null): boolean {
  return readsCompany(actor) || (departmentId !== null && isDepartmentManager(actor, departmentId));
}

function uuidList(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/** SQL condition on `tasks`: rows the actor may see (deleted rows are filtered separately). */
export function visibleTasks(actor: Actor): SQL {
  const me = actor.memberId;
  const involved = sql`(${s.tasks.assigneeId} = ${me} or ${s.tasks.reporterId} = ${me} or exists (
    select 1 from task_collaborators tc where tc.task_id = ${s.tasks.id} and tc.member_id = ${me}))`;
  const projectMember = sql`exists (
    select 1 from project_members pm where pm.project_id = ${s.tasks.projectId} and pm.member_id = ${me})`;
  const projectVisibility = sql`(select p.visibility from projects p where p.id = ${s.tasks.projectId})`;
  const notPrivate = sql`(${s.tasks.projectId} is null or ${projectVisibility} <> 'private' or ${projectMember})`;

  const readScope = scopeFor(actor, 'task.read');
  if (readScope === 'tenant') return sql`(${involved} or ${notPrivate})`;

  const departmentIds = actor.departments.map((d) => d.id);
  const inMyDepartments =
    departmentIds.length > 0 && readScope !== null && readScope !== 'own'
      ? sql`${s.tasks.departmentId} in (${uuidList(departmentIds)})`
      : sql`false`;
  return sql`(${involved} or ${projectMember} or ${projectVisibility} = 'tenant' or (${inMyDepartments} and ${notPrivate}))`;
}

/** SQL condition on `projects`: rows the actor may see. */
export function visibleProjects(actor: Actor): SQL {
  const me = actor.memberId;
  const member = sql`(${s.projects.ownerId} = ${me} or exists (
    select 1 from project_members pm where pm.project_id = ${s.projects.id} and pm.member_id = ${me}))`;
  const departmentIds = actor.departments.map((d) => d.id);
  const readScope = scopeFor(actor, 'project.read');
  const departmentVisible =
    readScope === 'tenant'
      ? sql`true`
      : departmentIds.length > 0
        ? sql`${s.projects.departmentId} in (${uuidList(departmentIds)})`
        : sql`false`;
  return sql`(${member} or ${s.projects.visibility} = 'tenant' or (${s.projects.visibility} = 'department' and ${departmentVisible}))`;
}

/**
 * SQL condition on `projects`: whether the member `memberId` (an SQL expression) sees the project.
 * The same rule as `visibleProjects`, for someone other than the actor: a task in a project may go
 * to anyone who sees it (plan phase-3-step-17a). Tenant-wide project readers are those with a
 * tenant `project.read` grant or in an oversight department over projects.
 */
export function projectReachableBy(memberId: SQL): SQL {
  return sql`(${s.projects.ownerId} = ${memberId}
    or exists (select 1 from project_members pm where pm.project_id = ${s.projects.id} and pm.member_id = ${memberId})
    or ${s.projects.visibility} = 'tenant'
    or (${s.projects.visibility} = 'department' and (
      exists (select 1 from department_memberships dm join departments d on d.id = dm.department_id
        where dm.member_id = ${memberId} and d.archived_at is null
          and dm.department_id = ${s.projects.departmentId})
      or exists (select 1 from member_roles mr join role_grants rg on rg.role_id = mr.role_id
        where mr.member_id = ${memberId} and rg.permission = 'project.read' and rg.scope = 'tenant')
      or exists (select 1 from department_memberships dm join departments d on d.id = dm.department_id
        where dm.member_id = ${memberId} and d.archived_at is null
          and coalesce(d.oversight -> 'resources', '[]'::jsonb) ? 'project'))))`;
}

/**
 * SQL condition on `projects`: where the actor may add work. Observers of a private project see it
 * but add nothing (plan phase-2-step-10b); other projects follow their visibility.
 */
export function usableProjects(actor: Actor): SQL {
  if (managesAll(actor)) return sql`true`;
  const me = actor.memberId;
  return sql`(${s.projects.visibility} <> 'private' or ${s.projects.ownerId} = ${me} or exists (
    select 1 from project_members pm where pm.project_id = ${s.projects.id} and pm.member_id = ${me}
      and pm.role in ('owner', 'member')))`;
}

export interface TaskForAccess {
  departmentId: string;
  assigneeId: string | null;
  reporterId: string;
  collaboratorIds: string[];
}

export function canEditTask(actor: Actor, task: TaskForAccess): boolean {
  const me = actor.memberId;
  return (
    task.assigneeId === me ||
    task.reporterId === me ||
    task.collaboratorIds.includes(me) ||
    isDepartmentManager(actor, task.departmentId) ||
    managesAll(actor)
  );
}

/** SQL twin of `canEditTask` on `tasks` (choosing a task to pin a letter to, ADR 0021). */
export function editableTasks(actor: Actor): SQL {
  if (managesAll(actor)) return sql`true`;
  const me = actor.memberId;
  const managed = actor.departments
    .filter((d) => d.deptRole === 'head' || d.deptRole === 'manager')
    .map((d) => d.id);
  return sql`(${s.tasks.assigneeId} = ${me} or ${s.tasks.reporterId} = ${me} or exists (
    select 1 from task_collaborators tc where tc.task_id = ${s.tasks.id} and tc.member_id = ${me} and tc.kind = 'collaborator')${
      managed.length ? sql` or ${s.tasks.departmentId} in (${uuidList(managed)})` : sql``
    })`;
}

export function canSetWeight(actor: Actor, departmentId: string): boolean {
  return isDepartmentManager(actor, departmentId) || managesAll(actor);
}

export function canDeleteTask(actor: Actor, task: TaskForAccess): boolean {
  return (
    task.reporterId === actor.memberId ||
    isDepartmentManager(actor, task.departmentId) ||
    managesAll(actor)
  );
}

export function canCreateIn(actor: Actor, departmentId: string): boolean {
  return isDepartmentMember(actor, departmentId) || managesAll(actor);
}

/**
 * The company's leadership (plan phase-3-step-17a): owners (all work) and executives (company
 * goals). They create projects anywhere and give work to anyone.
 */
export function leadsCompany(actor: Actor): boolean {
  return managesAll(actor) || scopeFor(actor, 'goal.manage') === 'tenant';
}

/** Projects are created by a department's head or managers, or by the leadership (17a). */
export function canCreateProject(actor: Actor, departmentId: string | null): boolean {
  return leadsCompany(actor) || (departmentId !== null && isDepartmentManager(actor, departmentId));
}

/**
 * Outside a project, work goes to someone else only from the leadership, a manager of one of that
 * person's departments, or someone above them in the reporting line (17a). Inside a project the
 * rule is project access instead.
 */
export function canAssignOutsideProject(
  actor: Actor,
  assignee: { memberId: string; departmentIds: readonly string[]; managers: readonly string[] },
): boolean {
  return (
    assignee.memberId === actor.memberId ||
    leadsCompany(actor) ||
    assignee.managers.includes(actor.memberId) ||
    assignee.departmentIds.some((id) => isDepartmentManager(actor, id))
  );
}

export function canEditProject(
  actor: Actor,
  project: { ownerId: string; departmentId: string | null; ownerMemberIds: string[] },
): boolean {
  return (
    project.ownerId === actor.memberId ||
    project.ownerMemberIds.includes(actor.memberId) ||
    (project.departmentId !== null && isDepartmentManager(actor, project.departmentId)) ||
    managesAll(actor)
  );
}
