import { schema as s } from '@madar/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Who sees a conversation (ADR 0022), as SQL on `conversations`:
 *   project channel    the project's members (any role)
 *   department channel the department's members (any role)
 *   direct and group   their current members
 * No role or permission is an exception: managers, admins and owners see only their own.
 */
export function visibleConversations(memberId: string): SQL {
  return sql`(
    (${s.conversations.kind} = 'project' and exists (select 1 from project_members pm
      where pm.project_id = ${s.conversations.projectId} and pm.member_id = ${memberId}))
    or (${s.conversations.kind} = 'department' and exists (select 1 from department_memberships dm
      where dm.department_id = ${s.conversations.departmentId} and dm.member_id = ${memberId}))
    or (${s.conversations.kind} in ('direct', 'group') and exists (select 1 from conversation_members cm
      where cm.conversation_id = ${s.conversations.id} and cm.member_id = ${memberId} and cm.left_at is null))
  )`;
}

/**
 * Who may write: a member who is not a project observer or department viewer, in a project that
 * is not archived and a department that is active.
 */
export function postableConversations(memberId: string): SQL {
  return sql`(
    (${s.conversations.kind} = 'project' and exists (select 1 from project_members pm
      join projects p on p.id = pm.project_id
      where pm.project_id = ${s.conversations.projectId} and pm.member_id = ${memberId}
        and pm.role <> 'observer' and p.status = 'active'))
    or (${s.conversations.kind} = 'department' and exists (select 1 from department_memberships dm
      join departments d on d.id = dm.department_id
      where dm.department_id = ${s.conversations.departmentId} and dm.member_id = ${memberId}
        and dm.dept_role <> 'viewer' and d.archived_at is null))
    or (${s.conversations.kind} in ('direct', 'group') and exists (select 1 from conversation_members cm
      where cm.conversation_id = ${s.conversations.id} and cm.member_id = ${memberId} and cm.left_at is null))
  )`;
}

/** Everyone who can read the conversation now (active members only), for live delivery. */
export function audienceOf(conversationId: string): SQL {
  return sql`(
    select m.id from members m join conversations c on c.id = ${conversationId}
    where m.status = 'active' and (
      (c.kind = 'project' and exists (select 1 from project_members pm
        where pm.project_id = c.project_id and pm.member_id = m.id))
      or (c.kind = 'department' and exists (select 1 from department_memberships dm
        where dm.department_id = c.department_id and dm.member_id = m.id))
      or (c.kind in ('direct', 'group') and exists (select 1 from conversation_members cm
        where cm.conversation_id = c.id and cm.member_id = m.id and cm.left_at is null))
    )
  )`;
}

/** The same rule as `visibleConversations`, for raw queries that alias the table as `c`. */
export function visibleConversationsRaw(memberId: string): SQL {
  return sql`(
    (c.kind = 'project' and exists (select 1 from project_members pm
      where pm.project_id = c.project_id and pm.member_id = ${memberId}))
    or (c.kind = 'department' and exists (select 1 from department_memberships dm
      where dm.department_id = c.department_id and dm.member_id = ${memberId}))
    or (c.kind in ('direct', 'group') and exists (select 1 from conversation_members cm
      where cm.conversation_id = c.id and cm.member_id = ${memberId} and cm.left_at is null))
  )`;
}
