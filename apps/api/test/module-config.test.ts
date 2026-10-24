import { schema as s, withTenant, type DbHandle } from '@madar/db';
import type { DepartmentConfigDetail, ModuleConfig, Task, TemplateSummary } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

describe.skipIf(!hasDatabase)('department templates and configs (plan phase-3-step-19a)', () => {
  let app: NestExpressApplication;
  let env: Env;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let head: Person;
  let agent: Person;
  let other: Client;
  let supportId: string;
  let legacyId: string;

  const detail = async (id: string) =>
    (await owner.get(`/api/departments/${id}/config`)).body as DepartmentConfigDetail;
  const newTask = (p: Person, body: object) =>
    p.c.post('/api/tasks', { title: 'تیکت آزمایشی', departmentId: supportId, ...body });

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    handle = app.get<DbHandle>(DB_HANDLE);
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    const support = await owner.post('/api/departments', {
      name: 'پشتیبانی',
      templateKey: 'support',
    });
    expect(support.status).toBe(201);
    supportId = support.body.id;
    // A department from before step 19a: no config row at all.
    const [legacy] = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.insert(s.departments).values({ name: 'قدیمی' }).returning({ id: s.departments.id }),
    );
    legacyId = legacy?.id as string;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    head = await memberSession(app, env, owner, { departments: dept(supportId, 'head') });
    agent = await memberSession(app, env, owner, {
      departments: [
        ...dept(supportId),
        { departmentId: legacyId, deptRole: 'member', isPrimary: false },
      ],
      managerId: head.memberId,
    });
    other = (await ownerSession(app, env)).c;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('lists the six built-in templates in Persian', async () => {
    const res = await agent.c.get('/api/templates');
    expect(res.status).toBe(200);
    const templates = res.body as TemplateSummary[];
    expect(templates.map((t) => t.key)).toEqual([
      'general',
      'executive',
      'engineering',
      'marketing',
      'support',
      'hr',
    ]);
    expect(templates.find((t) => t.key === 'support')).toMatchObject({
      name: 'پشتیبانی',
      types: ['تیکت', 'کار'],
    });
  });

  it('a new department starts from its template; an old one runs on the general config', async () => {
    const support = await detail(supportId);
    expect(support).toMatchObject({ version: 1, templateKey: 'support' });
    expect(support.config.vocabulary.task).toBe('تیکت');
    const legacy = await detail(legacyId);
    expect(legacy.version).toBe(0);
    expect(legacy.config.workflows[0]?.statuses.map((st) => st.key)).toEqual([
      'todo',
      'in_progress',
      'done',
      'canceled',
    ]);
    const all = (await agent.c.get('/api/module-configs')).body as { departmentId: string }[];
    expect(all.map((c) => c.departmentId)).toEqual(expect.arrayContaining([supportId, legacyId]));
  });

  it('new work takes the default type and first status, and checks fields', async () => {
    const quick = await newTask(agent, {});
    expect(quick.status).toBe(201);
    expect(quick.body).toMatchObject({ typeKey: 'ticket', statusKey: 'new', customFields: {} });

    const full = await newTask(agent, {
      typeKey: 'ticket',
      customFields: { channel: 'phone', customer: '  مریم  ' },
    });
    expect(full.status).toBe(201);
    expect(full.body.customFields).toEqual({ channel: 'phone', customer: 'مریم' });

    const bad = await newTask(agent, { customFields: { channel: 'fax' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({
      code: 'invalid_field_value',
      details: { field: 'channel' },
    });
    expect((await newTask(agent, { statusKey: 'review' })).body.error.code).toBe('unknown_status');
    expect((await newTask(agent, { typeKey: 'bug' })).body.error.code).toBe('unknown_type');
  });

  it('done, reopen and progress go to the workflow’s statuses of that category', async () => {
    const task = (await newTask(agent, {})).body as Task;
    const done = await agent.c.patch(`/api/tasks/${task.id}`, {
      version: task.version,
      statusCategory: 'done',
    });
    expect(done.body).toMatchObject({ statusKey: 'done', statusCategory: 'done' });
    expect(done.body.completedAt).not.toBeNull();
    const reopened = await agent.c.patch(`/api/tasks/${task.id}`, {
      version: done.body.version,
      statusCategory: 'todo',
    });
    expect(reopened.body).toMatchObject({ statusKey: 'new', completedAt: null });
    const progressed = await agent.c.post(`/api/tasks/${task.id}/progress`, {
      version: reopened.body.version,
      value: 20,
    });
    expect(progressed.body).toMatchObject({ statusKey: 'in_progress', progress: 20 });
    const waiting = await agent.c.patch(`/api/tasks/${task.id}`, {
      version: progressed.body.version,
      statusKey: 'waiting_customer',
    });
    expect(waiting.body).toMatchObject({
      statusKey: 'waiting_customer',
      statusCategory: 'in_progress',
    });
  });

  it('saving needs the version it read, mappings for used statuses, and keeps old versions', async () => {
    const current = await detail(supportId);
    expect(current.usage.statuses.waiting_customer).toBeGreaterThan(0);
    const next: ModuleConfig = structuredClone(current.config);
    const main = next.workflows[0] as ModuleConfig['workflows'][number];
    main.statuses = main.statuses.filter((st) => st.key !== 'waiting_customer');
    main.statuses.push({
      key: 's_legal1',
      label: 'در انتظار حقوقی',
      category: 'in_progress',
      color: 'violet',
    });

    const stale = await owner.put(`/api/departments/${supportId}/config`, {
      version: 0,
      config: next,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('config_version_conflict');

    const unmapped = await owner.put(`/api/departments/${supportId}/config`, {
      version: 1,
      config: next,
    });
    expect(unmapped.body.error).toMatchObject({
      code: 'status_mapping_required',
      details: { statuses: ['waiting_customer'] },
    });
    const crossCategory = await owner.put(`/api/departments/${supportId}/config`, {
      version: 1,
      config: next,
      mappings: { statuses: { waiting_customer: 'done' } },
    });
    expect(crossCategory.body.error.code).toBe('status_mapping_required');

    const recategorised: ModuleConfig = structuredClone(current.config);
    const status = recategorised.workflows[0]?.statuses.find((st) => st.key === 'in_progress');
    if (status) status.category = 'done';
    const moved = await owner.put(`/api/departments/${supportId}/config`, {
      version: 1,
      config: recategorised,
    });
    expect(moved.body.error.code).toBe('invalid_config');

    const saved = await owner.put(`/api/departments/${supportId}/config`, {
      version: 1,
      config: next,
      mappings: { statuses: { waiting_customer: 's_legal1' } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ version: 2 });
    expect(saved.body.usage.statuses.waiting_customer).toBeUndefined();
    expect(saved.body.usage.statuses.s_legal1).toBeGreaterThan(0);

    const versions = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select({ version: s.moduleConfigs.version })
        .from(s.moduleConfigs)
        .where(eq(s.moduleConfigs.departmentId, supportId)),
    );
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
    const audit = (await owner.get('/api/audit?action=department.config_saved')).body;
    expect(JSON.stringify(audit)).toContain('department.config_saved');
  });

  it('a required field must be filled by a form that knows the type, not by a quick capture', async () => {
    const current = await detail(supportId);
    const next: ModuleConfig = structuredClone(current.config);
    const channel = next.fields.find((f) => f.key === 'channel');
    if (channel) channel.required = true;
    const saved = await owner.put(`/api/departments/${supportId}/config`, {
      version: current.version,
      config: next,
    });
    expect(saved.status).toBe(200);
    const missing = await newTask(agent, { typeKey: 'ticket', customFields: {} });
    expect(missing.body.error).toMatchObject({
      code: 'required_field_missing',
      details: { field: 'channel' },
    });
    expect((await newTask(agent, {})).status).toBe(201);
  });

  it('the type’s default weight applies, except on one’s own task without weight rights', async () => {
    const legacy = await detail(legacyId);
    const applied = await owner.post(`/api/departments/${legacyId}/apply-template`, {
      version: legacy.version,
      templateKey: 'engineering',
    });
    expect(applied.status).toBe(201);
    expect(applied.body).toMatchObject({ version: 1, templateKey: 'engineering' });

    const own = await agent.c.post('/api/tasks', {
      title: 'باگ خودم',
      departmentId: legacyId,
      typeKey: 'bug',
      customFields: {},
    });
    expect(own.body).toMatchObject({ typeKey: 'bug', weight: 1, statusKey: 'backlog' });
    const given = await head.c.post('/api/tasks', {
      title: 'تیکت برای همکار',
      departmentId: supportId,
      assigneeId: agent.memberId,
      typeKey: 'ticket',
      customFields: { channel: 'chat' },
    });
    expect(given.status).toBe(201);
    expect(given.body.weight).toBe(1);
  });

  it('changing a task’s type keeps a status its workflow has and checks the new fields', async () => {
    const task = (await agent.c.post('/api/tasks', { title: 'کار', departmentId: legacyId })).body;
    expect(task.typeKey).toBe('task');
    const bug = await agent.c.patch(`/api/tasks/${task.id}`, {
      version: task.version,
      typeKey: 'bug',
      customFields: { severity: 'high' },
    });
    expect(bug.body).toMatchObject({ typeKey: 'bug', customFields: { severity: 'high' } });
    const wrong = await agent.c.patch(`/api/tasks/${task.id}`, {
      version: bug.body.version,
      customFields: { points: 3 },
    });
    expect(wrong.body.error.code).toBe('invalid_field_value');
  });

  it('only admins change configs, and another company sees none of it', async () => {
    const current = await detail(supportId);
    const denied = await head.c.put(`/api/departments/${supportId}/config`, {
      version: current.version,
      config: current.config,
    });
    expect(denied.status).toBe(403);
    expect((await other.get(`/api/departments/${supportId}/config`)).status).toBe(404);
    const theirs = (await other.get('/api/module-configs')).body as { departmentId: string }[];
    expect(theirs.map((c) => c.departmentId)).not.toContain(supportId);
  });
});
