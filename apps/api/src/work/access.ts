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
