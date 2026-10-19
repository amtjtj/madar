import type { Project, Task } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

describe.skipIf(!hasDatabase)('task progress, project progress and observers', () => {
  let app: NestExpressApplication;
  let owner: Client;
  let lead: Person;
  let ali: Person;
  let marketer: Person;
  let other: Client;
  let support: { id: string };

  const create = async (c: Client, body: object): Promise<Task> => {
    const res = await c.post('/api/tasks', body);
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
    return res.body;
  };
  const progress = (c: Client, task: Task, value: number, note?: string) =>
    c.post(`/api/tasks/${task.id}/progress`, { value, version: task.version, note });

  beforeAll(async () => {
    let env;
    ({ app, env } = await createTestApp());
    owner = (await ownerSession(app, env)).c;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    lead = await memberSession(app, env, owner, { departments: dept(support.id, 'manager') });
    ali = await memberSession(app, env, owner, { departments: dept(support.id) });
    marketer = await memberSession(app, env, owner, { departments: dept(marketing.id) });
    other = (await ownerSession(app, env)).c;
  });
  afterAll(() => app?.close());

  it('records progress with a note in the history and starts the task', async () => {
    const task = await create(lead.c, { title: 'پیگیری قرارداد', assigneeId: ali.memberId });
    const res = await progress(ali.c, task, 50, 'با واحد حقوقی تماس گرفتم');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ progress: 50, statusCategory: 'in_progress' });
    const history = (await ali.c.get(`/api/tasks/${task.id}/activity`)).body as Array<{
      verb: string;
      changes: Record<string, { to: unknown }>;
    }>;
    expect(history.find((a) => a.verb === 'progress')?.changes).toMatchObject({
      progress: { from: 0, to: 50 },
      note: { to: 'با واحد حقوقی تماس گرفتم' },
    });

    // Steps of five, a stale version, and closed tasks are refused.
    expect((await progress(ali.c, res.body, 33)).status).toBe(400);
    expect((await progress(ali.c, task, 60)).status).toBe(409);
    const done = (
      await ali.c.patch(`/api/tasks/${task.id}`, { statusKey: 'done', version: res.body.version })
    ).body as Task;
    expect(done.progress).toBe(100);
    expect((await progress(ali.c, done, 60)).body.error.code).toBe('progress_closed');
    // Reopened: back to what was recorded.
    const reopened = (
      await ali.c.patch(`/api/tasks/${task.id}`, {
        statusKey: 'in_progress',
        version: done.version,
      })
    ).body as Task;
    expect(reopened.progress).toBe(50);
    // Only people who may edit the task record progress.
    expect((await progress(marketer.c, reopened, 60)).status).toBe(404);
  });

  it('computes a parent from its subtasks until switched to manual', async () => {
    const parent = await create(ali.c, { title: 'راه‌اندازی صف تازه' });
    const a = await create(ali.c, { title: 'الف', parentId: parent.id });
    const b = await create(ali.c, { title: 'ب', parentId: parent.id });
    await progress(ali.c, a, 50);
    const get = async (id: string): Promise<Task> => (await ali.c.get(`/api/tasks/${id}`)).body;
    expect((await get(parent.id)).progress).toBe(25);
    expect((await progress(ali.c, await get(parent.id), 80)).body.error.code).toBe('progress_auto');

    await ali.c.patch(`/api/tasks/${b.id}`, { statusKey: 'done', version: b.version });
    expect((await get(parent.id)).progress).toBe(75);
    await ali.c.delete(`/api/tasks/${b.id}`);
    expect((await get(parent.id)).progress).toBe(50);

    const manual = (
      await ali.c.patch(`/api/tasks/${parent.id}`, {
        progressMode: 'manual',
        version: (await get(parent.id)).version,
      })
    ).body as Task;
    expect((await progress(ali.c, manual, 90)).body.progress).toBe(90);
    const auto = (
      await ali.c.patch(`/api/tasks/${parent.id}`, {
        progressMode: 'auto',
        version: (await get(parent.id)).version,
      })
    ).body as Task;
    expect(auto.progress).toBe(50);

    // A task with recorded progress keeps it when its first subtask arrives.
    const recorded = await create(ali.c, { title: 'گزارش' });
    await progress(ali.c, recorded, 40);
    await create(ali.c, { title: 'زیرکار', parentId: recorded.id });
    expect(await get(recorded.id)).toMatchObject({ progress: 40, progressMode: 'manual' });
  });

  it('weights project progress and lets observers watch without adding work', async () => {
    const project = (
      await lead.c.post('/api/projects', {
        name: 'پروژه محرمانه',
        departmentId: support.id,
        visibility: 'private',
        memberIds: [ali.memberId],
      })
    ).body as Project;
    const heavy = await create(lead.c, {
      title: 'سنگین',
      projectId: project.id,
      weight: 3,
      assigneeId: ali.memberId,
    });
    await create(lead.c, { title: 'سبک', projectId: project.id });
    await progress(ali.c, heavy, 40);
    const read = async (c: Client) => (await c.get(`/api/projects/${project.id}`)).body as Project;
    // (40×3 + 0×1) / 4 = 30 %
    expect((await read(lead.c)).tasks.progress).toBeCloseTo(0.3);

    expect((await marketer.c.get(`/api/projects/${project.id}`)).status).toBe(404);
    const members = (await read(lead.c)).members.map((m) => ({ memberId: m.id, role: m.role }));
    const set = await lead.c.put(`/api/projects/${project.id}/members`, {
      members: [...members, { memberId: marketer.memberId, role: 'observer' }],
    });
    expect(set.status).toBe(200);
    const seen = await read(marketer.c);
    expect(seen.can).toEqual({ edit: false, createTask: false });
    expect(seen.members.find((m) => m.id === marketer.memberId)?.role).toBe('observer');
    const tasks = (await marketer.c.get(`/api/tasks?view=project&projectId=${project.id}`))
      .body as Task[];
    expect(tasks.map((t) => t.title).sort()).toEqual(['سبک', 'سنگین']);
    expect(
      (await marketer.c.post('/api/tasks', { title: 'کار ناظر', projectId: project.id })).status,
    ).toBe(404);
    // Not even as a subtask of an existing task.
    expect(
      (await marketer.c.post('/api/tasks', { title: 'زیرکار ناظر', parentId: heavy.id })).status,
    ).toBe(404);
    expect((await read(ali.c)).can.createTask).toBe(true);

    const audit = (await owner.get('/api/audit-logs')).body as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toContain('project.members_updated');

    // Another company: neither the project nor its members.
    expect((await other.get(`/api/projects/${project.id}`)).status).toBe(404);
    expect(
      (
        await lead.c.put(`/api/projects/${project.id}/members`, {
          members: [{ memberId: (await other.get('/api/me')).body.member.id, role: 'observer' }],
        })
      ).status,
    ).toBe(404);
    expect((await progress(other, heavy, 60)).status).toBe(404);
  });
});
