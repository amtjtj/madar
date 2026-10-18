import { randomUUID } from 'node:crypto';

import { createDb, type DbHandle } from '../client.js';
import { loadRootEnv } from '../env.js';
import * as s from '../schema/index.js';
import { uuidv7 } from '../schema/columns.js';
import { withTenant } from '../tenant.js';

loadRootEnv();

export const hasDatabase = Boolean(
  process.env.APP_DATABASE_URL && process.env.DATABASE_URL && process.env.WORKER_DATABASE_URL,
);

/** Connection as the application role (subject to RLS). */
export function appDb(): DbHandle {
  return createDb(process.env.APP_DATABASE_URL ?? '', { max: 4 });
}

/** Connection as the worker role (ADR 0011): the app role plus the cross-tenant outbox functions. */
export function workerDb(): DbHandle {
  return createDb(process.env.WORKER_DATABASE_URL ?? '', { max: 4 });
}

/** Connection as the owner role (bypasses nothing in app code; used only to simulate tampering). */
export function ownerDb(): DbHandle {
  return createDb(process.env.DATABASE_URL ?? '', { max: 2 });
}

export interface TenantFixture {
  tenantId: string;
  userId: string;
  memberId: string;
  departmentId: string;
  roleId: string;
}

/** Creates a tenant with one row in every data-plane table, through the app role only. */
export async function createTenantFixture(handle: DbHandle, label = 't'): Promise<TenantFixture> {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await handle.db
    .insert(s.tenants)
    .values({ name: `${label}-${suffix}`, slug: `${label}-${suffix}` })
    .returning({ id: s.tenants.id });
  const [user] = await handle.db
    .insert(s.users)
    .values({
      name: `user ${suffix}`,
      email: `${uuidv7()}@users.madar.invalid`,
      username: `${label}.${suffix}`,
    })
    .returning({ id: s.users.id });
  if (!tenant || !user) throw new Error('fixture insert failed');

  return withTenant(handle.db, { tenantId: tenant.id, userId: user.id }, async (tx) => {
    const [member] = await tx
      .insert(s.members)
      .values({ userId: user.id, displayName: `member ${suffix}` })
      .returning({ id: s.members.id });
    const [department] = await tx
      .insert(s.departments)
      .values({ name: `dept ${suffix}`, headMemberId: member?.id })
      .returning({ id: s.departments.id });
    const [role] = await tx
      .insert(s.roles)
      .values({ key: 'member', name: 'Member', isSystem: true })
      .returning({ id: s.roles.id });
    if (!member || !department || !role) throw new Error('fixture insert failed');
    await tx.insert(s.departmentMemberships).values({
      departmentId: department.id,
      memberId: member.id,
      deptRole: 'head',
      isPrimary: true,
    });
    await tx
      .insert(s.roleGrants)
      .values({ roleId: role.id, permission: 'task.read', scope: 'department' });
    await tx.insert(s.memberRoles).values({ memberId: member.id, roleId: role.id });

    // Work core: one row in every table
    const [project] = await tx
      .insert(s.projects)
      .values({ name: `project ${suffix}`, departmentId: department.id, ownerId: member.id })
      .returning({ id: s.projects.id });
    const [task] = await tx
      .insert(s.tasks)
      .values({
        title: `task ${suffix}`,
        departmentId: department.id,
        projectId: project?.id,
        reporterId: member.id,
        assigneeId: member.id,
      })
      .returning({ id: s.tasks.id });
    if (!project || !task) throw new Error('fixture insert failed');
    await tx
      .insert(s.projectMembers)
      .values({ projectId: project.id, memberId: member.id, role: 'owner' });
    await tx.insert(s.taskCollaborators).values({ taskId: task.id, memberId: member.id });
    await tx
      .insert(s.comments)
      .values({ subjectType: 'task', subjectId: task.id, authorId: member.id, body: 'hi' });
    await tx
      .insert(s.activities)
      .values({ subjectType: 'task', subjectId: task.id, actorId: member.id, verb: 'created' });
    await tx
      .insert(s.dailyPlanItems)
      .values({ memberId: member.id, planDate: '2026-10-17', taskId: task.id });
    await tx
      .insert(s.domainEvents)
      .values({ type: 'task.created', payload: { taskId: task.id }, actorId: member.id });

    // Notifications: one row in every table
    await tx
      .insert(s.workCalendars)
      .values({ weeklyHours: [null, null, null, null, null, null, null] });
    await tx.insert(s.notifications).values({
      recipientId: member.id,
      kind: 'task_assigned',
      subjectType: 'task',
      subjectId: task.id,
      dedupeKey: `fixture:${suffix}`,
    });
    await tx.insert(s.notificationPreferences).values({ memberId: member.id });
    await tx.insert(s.processedEvents).values({ consumer: 'fixture', eventId: uuidv7() });
    // Goals: one row in every table
    const [period] = await tx
      .insert(s.goalPeriods)
      .values({ year: 1405, quarter: 3, startOn: '2026-09-23', endOn: '2026-12-21' })
      .returning();
    if (!period) throw new Error('period insert failed');
    const [goal] = await tx
      .insert(s.goals)
      .values({
        periodId: period.id,
        level: 'department',
        departmentId: department.id,
        ownerId: member.id,
        createdBy: member.id,
        title: 'هدف',
      })
      .returning();
    if (!goal) throw new Error('goal insert failed');
    const [kr] = await tx
      .insert(s.keyResults)
      .values({ goalId: goal.id, title: 'نتیجه', kind: 'number', targetValue: 10 })
      .returning();
    if (!kr) throw new Error('key result insert failed');
    await tx
      .insert(s.keyResultCheckins)
      .values({ keyResultId: kr.id, value: 3, status: 'on_track', authorId: member.id });
    await tx.insert(s.pushSubscriptions).values({
      memberId: member.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
      p256dh: 'BKey',
      auth: 'auth',
    });
    return {
      tenantId: tenant.id,
      userId: user.id,
      memberId: member.id,
      departmentId: department.id,
      roleId: role.id,
    };
  });
}
