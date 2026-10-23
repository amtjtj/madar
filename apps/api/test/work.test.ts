import { schema as s, withTenant, type DbHandle } from '@madar/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

interface Session {
  c: Client;
  memberId: string;
}

describe.skipIf(!hasDatabase)('work: projects, tasks, comments, activity', () => {
  let app: NestExpressApplication;
  let env: Env;
  let tenantId: string;
  let owner: Client;
  let support: { id: string };
  let marketing: { id: string };
  let management: { id: string };
  let lead: Session; // support manager
  let agent: Session; // support member
  let colleague: Session; // support member
  let marketer: Session; // marketing member
  let director: Session; // management (oversight on tasks)

  const ids = (res: { body: Array<{ id: string }> }) => res.body.map((t) => t.id);

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    marketing = (await owner.post('/api/departments', { name: 'بازاریابی' })).body;
    management = (await owner.post('/api/departments', { name: 'مدیریت' })).body;
    await owner.put(`/api/departments/${management.id}/oversight`, {
      resources: ['task', 'project'],
    });
    const dept = (departmentId: string, deptRole = 'member') => [
      { departmentId, deptRole, isPrimary: true },
    ];
    lead = await memberSession(app, env, owner, { departments: dept(support.id, 'manager') });
    agent = await memberSession(app, env, owner, { departments: dept(support.id) });
    colleague = await memberSession(app, env, owner, { departments: dept(support.id) });
    marketer = await memberSession(app, env, owner, { departments: dept(marketing.id) });
    director = await memberSession(app, env, owner, { departments: dept(management.id) });
  });
  afterAll(() => app?.close());

  it('creates a task in the primary department, assigned to the creator by default', async () => {
    const res = await agent.c.post('/api/tasks', { title: 'پاسخ به تیکت‌های امروز' });
    expect(res.status).toBe(201);
    expect(res.body.department.id).toBe(support.id);
    expect(res.body.assignee.id).toBe(agent.memberId);
    expect(res.body.statusCategory).toBe('todo');
    expect(res.body.weight).toBe(1);
    expect(res.body.version).toBe(1);
    expect(res.body.can).toEqual({ edit: true, setWeight: false, delete: true });

    const mine = await agent.c.get('/api/tasks?view=mine');
    expect(ids(mine)).toContain(res.body.id);
  });

  it('needs a department to create tasks', async () => {
    const loner = await memberSession(app, env, owner, {});
    const res = await loner.c.post('/api/tasks', { title: 'کار' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('no_department');
  });

  it('does not let members create tasks in other departments', async () => {
    const res = await agent.c.post('/api/tasks', { title: 'کار', departmentId: marketing.id });
    expect(res.status).toBe(403);
  });

  it('applies the visibility rules across departments, involvement and oversight', async () => {
    const task = (await colleague.c.post('/api/tasks', { title: 'به‌روزرسانی پاسخ‌های آماده' }))
      .body;

    // Same department sees it; another department does not.
    expect(ids(await agent.c.get('/api/tasks?view=department'))).toContain(task.id);
    expect((await agent.c.get(`/api/tasks/${task.id}`)).status).toBe(200);
    expect((await marketer.c.get(`/api/tasks/${task.id}`)).status).toBe(404);
    expect(ids(await marketer.c.get('/api/tasks?view=visible'))).not.toContain(task.id);
    expect((await marketer.c.post(`/api/tasks/${task.id}/comments`, { body: 'سلام' })).status).toBe(
      404,
    );

    // Oversight department reads everything (but cannot edit).
    expect((await director.c.get(`/api/tasks/${task.id}`)).status).toBe(200);
    const edit = await director.c.patch(`/api/tasks/${task.id}`, { version: 1, title: 'تغییر' });
    expect(edit.status).toBe(403);

    // A member gives work outside a project only to themselves (plan phase-3-step-17a)…
    const refused = await colleague.c.patch(`/api/tasks/${task.id}`, {
      version: 1,
      assigneeId: marketer.memberId,
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('assignee_not_allowed');
    // …the leadership to anyone; assigning across departments makes the task visible.
    const assigned = await owner.patch(`/api/tasks/${task.id}`, {
      version: 1,
      assigneeId: marketer.memberId,
    });
    expect(assigned.status).toBe(200);
    expect((await marketer.c.get(`/api/tasks/${task.id}`)).status).toBe(200);
    expect(ids(await marketer.c.get('/api/tasks?view=mine'))).toContain(task.id);
  });

  it('keeps private projects private, even from oversight', async () => {
    const project = await lead.c.post('/api/projects', {
      name: 'پروژه محرمانه',
      departmentId: support.id,
      visibility: 'private',
      memberIds: [agent.memberId, marketer.memberId],
    });
    expect(project.status).toBe(201);
    expect(project.body.members).toHaveLength(3);
    const task = (
      await agent.c.post('/api/tasks', { title: 'کار محرمانه', projectId: project.body.id })
    ).body;

    expect((await colleague.c.get(`/api/tasks/${task.id}`)).status).toBe(404);
    expect((await director.c.get(`/api/tasks/${task.id}`)).status).toBe(404);
    expect((await director.c.get(`/api/projects/${project.body.id}`)).status).toBe(404);
    expect((await marketer.c.get(`/api/tasks/${task.id}`)).status).toBe(200);
    const projectTasks = await marketer.c.get(
      `/api/tasks?view=project&projectId=${project.body.id}`,
    );
    expect(ids(projectTasks)).toEqual([task.id]);
    expect(ids(await colleague.c.get('/api/projects'))).not.toContain(project.body.id);
  });

  it('projects come from managers and the leadership; project work goes to who sees the project', async () => {
    // Plan phase-3-step-17a.
    const create = (c: Client, departmentId?: string) =>
      c.post('/api/projects', { name: 'پروژه تازه', departmentId, visibility: 'private' });
    expect((await create(agent.c, support.id)).status).toBe(403);
    expect((await create(lead.c, marketing.id)).status).toBe(403);
    expect((await create(lead.c)).status).toBe(403);
    expect((await create(owner)).status).toBe(201);
    const project = (
      await lead.c.post('/api/projects', {
        name: 'درگاه تازه',
        departmentId: support.id,
        visibility: 'private',
        memberIds: [agent.memberId, marketer.memberId],
      })
    ).body;

    // A member from another department creates work in it, for another project member…
    const made = await marketer.c.post('/api/tasks', {
      title: 'متن صفحه پرداخت',
      projectId: project.id,
      assigneeId: agent.memberId,
    });
    expect(made.status).toBe(201);
    expect(made.body.department.id).toBe(support.id);
    // …but not for someone who cannot see the project, and not into another department.
    const outsider = await marketer.c.post('/api/tasks', {
      title: 'کار',
      projectId: project.id,
      assigneeId: colleague.memberId,
    });
    expect(outsider.status).toBe(403);
    expect(outsider.body.error.code).toBe('assignee_not_allowed');
    expect(
      (
        await marketer.c.post('/api/tasks', {
          title: 'کار',
          projectId: project.id,
          departmentId: management.id,
        })
      ).status,
    ).toBe(403);
    const reassign = await agent.c.patch(`/api/tasks/${made.body.id}`, {
      version: 1,
      assigneeId: colleague.memberId,
    });
    expect(reassign.body.error?.code).toBe('assignee_not_allowed');

    // Who the form offers: in the project its people; outside it me, or my department.
    const names = async (c: Client, query = '') =>
      ((await c.get(`/api/tasks/assignees${query}`)).body as Array<{ id: string }>).map(
        (p) => p.id,
      );
    expect((await names(marketer.c, `?projectId=${project.id}`)).sort()).toEqual(
      [lead.memberId, agent.memberId, marketer.memberId].sort(),
    );
    expect(await names(agent.c)).toEqual([agent.memberId]);
    const team = await names(lead.c);
    expect(team).toEqual(
      expect.arrayContaining([lead.memberId, agent.memberId, colleague.memberId]),
    );
    expect(team).not.toContain(marketer.memberId);
    expect((await colleague.c.get(`/api/tasks/assignees?projectId=${project.id}`)).status).toBe(
      404,
    );
  });

  it('outside a project, work goes to others only from their manager or the leadership', async () => {
    const give = (c: Client, assigneeId: string) =>
      c.post('/api/tasks', { title: 'پیگیری تیکت', assigneeId });
    expect((await give(agent.c, colleague.memberId)).status).toBe(403);
    expect((await give(agent.c, agent.memberId)).status).toBe(201);
    expect((await give(lead.c, agent.memberId)).status).toBe(201);
    expect((await give(lead.c, marketer.memberId)).status).toBe(403);
    const fromOwner = await owner.post('/api/tasks', {
      title: 'پیگیری کمپین',
      departmentId: marketing.id,
      assigneeId: marketer.memberId,
    });
    expect(fromOwner.status).toBe(201);
    const unassigned = await agent.c.post('/api/tasks', { title: 'بدون مسئول', assigneeId: null });
    expect(unassigned.status).toBe(201);
  });

  it('a task given inside a project does not leave it with a peer on it', async () => {
    const project = (
      await lead.c.post('/api/projects', {
        name: 'تیکت‌های مشترک',
        departmentId: support.id,
        memberIds: [agent.memberId, colleague.memberId],
      })
    ).body;
    const task = (
      await agent.c.post('/api/tasks', {
        title: 'کمک در تیکت',
        projectId: project.id,
        assigneeId: colleague.memberId,
      })
    ).body;
    const out = await agent.c.patch(`/api/tasks/${task.id}`, { version: 1, projectId: null });
    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe('assignee_not_allowed');
    // The manager may move it out: the colleague is in the department she runs.
    expect(
      (await lead.c.patch(`/api/tasks/${task.id}`, { version: 1, projectId: null })).status,
    ).toBe(200);
  });

  it('someone above in the reporting line gives work like a department manager', async () => {
    // Neither runs a department; the line is set on the member (ADR 0027).
    const senior = await memberSession(app, env, owner, {
      departments: [{ departmentId: marketing.id, deptRole: 'member', isPrimary: true }],
    });
    const junior = await memberSession(app, env, owner, {
      departments: [{ departmentId: marketing.id, deptRole: 'member', isPrimary: true }],
      managerId: senior.memberId,
    });
    const given = await senior.c.post('/api/tasks', {
      title: 'گزارش کمپین',
      assigneeId: junior.memberId,
    });
    expect(given.status).toBe(201);
    const list = (await senior.c.get('/api/tasks/assignees')).body as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toEqual(
      expect.arrayContaining([senior.memberId, junior.memberId]),
    );
    expect(list.map((p) => p.id)).not.toContain(marketer.memberId);
    // Not upwards.
    const up = await junior.c.post('/api/tasks', { title: 'x', assigneeId: senior.memberId });
    expect(up.status).toBe(403);
  });

  it('another company reaches none of it, its owner included', async () => {
    const theirs = await ownerSession(app, env);
    const project = (
      await lead.c.post('/api/projects', { name: 'فقط ما', departmentId: support.id })
    ).body;
    expect((await theirs.c.get(`/api/tasks/assignees?projectId=${project.id}`)).status).toBe(404);
    const list = (await theirs.c.get('/api/tasks/assignees')).body as Array<{ id: string }>;
    for (const p of [lead, agent, colleague, marketer]) {
      expect(list.map((x) => x.id)).not.toContain(p.memberId);
    }
    const department = (await theirs.c.post('/api/departments', { name: 'پشتیبانی' })).body;
    const given = await theirs.c.post('/api/tasks', {
      title: 'x',
      departmentId: department.id,
      assigneeId: agent.memberId,
    });
    expect(given.status).toBe(404);
    expect(
      (
        await theirs.c.post('/api/tasks', {
          title: 'x',
          departmentId: department.id,
          projectId: project.id,
        })
      ).status,
    ).toBe(404);
  });

  it('shows company-wide projects to everyone', async () => {
    const project = (
      await lead.c.post('/api/projects', {
        name: 'جشنواره پاییز',
        departmentId: support.id,
        visibility: 'tenant',
      })
    ).body;
    const task = (await lead.c.post('/api/tasks', { title: 'بنر', projectId: project.id })).body;
    expect(ids(await marketer.c.get('/api/projects'))).toContain(project.id);
    expect((await marketer.c.get(`/api/tasks/${task.id}`)).status).toBe(200);
    expect(project.can.edit).toBe(true);
    expect((await marketer.c.patch(`/api/projects/${project.id}`, { name: 'x y' })).status).toBe(
      403,
    );
  });

  it('lets only department managers set the weight', async () => {
    const denied = await agent.c.post('/api/tasks', { title: 'کار سنگین', weight: 4 });
    expect(denied.status).toBe(403);

    const task = (await agent.c.post('/api/tasks', { title: 'کار سنگین' })).body;
    const patch = await agent.c.patch(`/api/tasks/${task.id}`, { version: 1, weight: 3 });
    expect(patch.status).toBe(403);

    const byLead = await lead.c.patch(`/api/tasks/${task.id}`, { version: 1, weight: 3 });
    expect(byLead.status).toBe(200);
    expect(byLead.body.weight).toBe(3);
    expect(byLead.body.can.setWeight).toBe(true);
  });

  it('rejects stale edits with version_conflict', async () => {
    const task = (await agent.c.post('/api/tasks', { title: 'نسخه' })).body;
    const first = await agent.c.patch(`/api/tasks/${task.id}`, { version: 1, title: 'نسخه ۲' });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(2);
    const stale = await lead.c.patch(`/api/tasks/${task.id}`, { version: 1, title: 'نسخه ۳' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
    expect(stale.body.error.details.task.title).toBe('نسخه ۲');
  });

  it('completes and reopens tasks, recording activity and events', async () => {
    const task = (
      await lead.c.post('/api/tasks', { title: 'گزارش هفتگی', assigneeId: agent.memberId })
    ).body;
    const done = await agent.c.post(`/api/tasks/${task.id}/move`, { statusKey: 'done' });
    expect(done.status).toBe(201);
    expect(done.body.statusCategory).toBe('done');
    expect(done.body.completedAt).not.toBeNull();
    const reopened = await agent.c.patch(`/api/tasks/${task.id}`, {
      version: done.body.version,
      statusKey: 'in_progress',
    });
    expect(reopened.body.completedAt).toBeNull();

    const activity = await agent.c.get(`/api/tasks/${task.id}/activity`);
    expect(activity.body.map((a: { verb: string }) => a.verb)).toEqual([
      'status_changed',
      'status_changed',
      'created',
    ]);
    expect(activity.body[0].changes.status).toEqual({ from: 'done', to: 'in_progress' });

    const handle = app.get<DbHandle>(DB_HANDLE);
    const events = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.domainEvents).orderBy(s.domainEvents.occurredAt),
    );
    const forTask = events
      .filter((e) => (e.payload as { taskId?: string }).taskId === task.id)
      .map((e) => e.type);
    expect(forTask).toEqual([
      'task.created',
      'task.assigned',
      'task.status_changed',
      'task.completed',
      'task.status_changed',
      'task.reopened',
    ]);
  });

  it('orders the board by fractional keys', async () => {
    const a = (await colleague.c.post('/api/tasks', { title: 'الف' })).body;
    const b = (await colleague.c.post('/api/tasks', { title: 'ب' })).body;
    expect(a.sortKey < b.sortKey).toBe(true);
    const moved = await colleague.c.post(`/api/tasks/${b.id}/move`, {
      statusKey: 'todo',
      beforeTaskId: a.id,
    });
    expect(moved.body.sortKey < a.sortKey).toBe(true);
  });

  it('supports comments: author edits, others cannot', async () => {
    const task = (await agent.c.post('/api/tasks', { title: 'کامنت' })).body;
    const comment = await agent.c.post(`/api/tasks/${task.id}/comments`, { body: 'شروع کردم' });
    expect(comment.status).toBe(201);
    expect(comment.body.can.edit).toBe(true);

    const byOther = await lead.c.patch(`/api/comments/${comment.body.id}`, { body: 'نه' });
    expect(byOther.status).toBe(403);
    const edited = await agent.c.patch(`/api/comments/${comment.body.id}`, { body: 'تمام شد' });
    expect(edited.body.editedAt).not.toBeNull();

    const list = await lead.c.get(`/api/tasks/${task.id}/comments`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ body: 'تمام شد', can: { edit: false } });
    expect((await agent.c.get(`/api/tasks/${task.id}`)).body.commentCount).toBe(1);

    expect((await agent.c.delete(`/api/comments/${comment.body.id}`)).status).toBe(204);
    const after = await lead.c.get(`/api/tasks/${task.id}/comments`);
    expect(after.body[0]).toMatchObject({ deleted: true, body: '' });
  });

  it('soft-deletes tasks with sub-tasks and writes the audit log', async () => {
    const parent = (await agent.c.post('/api/tasks', { title: 'والد' })).body;
    const child = (await agent.c.post('/api/tasks', { title: 'فرزند', parentId: parent.id })).body;
    expect((await agent.c.get(`/api/tasks/${parent.id}`)).body.subtasks).toEqual({
      total: 1,
      done: 0,
    });

    expect((await colleague.c.delete(`/api/tasks/${parent.id}`)).status).toBe(403);
    expect((await agent.c.delete(`/api/tasks/${parent.id}`)).status).toBe(204);
    expect((await agent.c.get(`/api/tasks/${parent.id}`)).status).toBe(404);
    expect((await agent.c.get(`/api/tasks/${child.id}`)).status).toBe(404);

    const audit = await owner.get('/api/audit-logs');
    const entry = audit.body.find(
      (e: { action: string; subjectId: string }) =>
        e.action === 'task.deleted' && e.subjectId === parent.id,
    );
    expect(entry).toBeDefined();
  });

  it('adds a new task to today when asked', async () => {
    const task = (await agent.c.post('/api/tasks', { title: 'امروز', addToToday: true })).body;
    const handle = app.get<DbHandle>(DB_HANDLE);
    const items = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.dailyPlanItems).where(eq(s.dailyPlanItems.taskId, task.id)),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.memberId).toBe(agent.memberId);
  });

  it('lets collaborators edit and validates members', async () => {
    const task = (await agent.c.post('/api/tasks', { title: 'همکاری' })).body;
    const set = await agent.c.put(`/api/tasks/${task.id}/collaborators`, {
      members: [{ memberId: marketer.memberId, kind: 'collaborator' }],
    });
    expect(set.status).toBe(200);
    expect(set.body.collaborators).toEqual([
      expect.objectContaining({ id: marketer.memberId, kind: 'collaborator' }),
    ]);
    const edit = await marketer.c.patch(`/api/tasks/${task.id}`, {
      version: set.body.version,
      priority: 'high',
    });
    expect(edit.status).toBe(200);
    expect(edit.body.priority).toBe('high');
  });
});
