import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Env } from '../src/config/env.js';
import {
  client,
  createTestApp,
  hasDatabase,
  memberSession,
  ownerSession,
  PASSWORD,
  signIn,
  signupCompany,
  type Client,
} from './helpers.js';

describe.skipIf(!hasDatabase)('organization: departments, members, roles, audit', () => {
  let app: NestExpressApplication;
  let env: Env;
  let owner: Client;
  let ownerMemberId: string;
  let support: { id: string };
  let executive: { id: string };

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    const session = await ownerSession(app, env);
    owner = session.c;
    ownerMemberId = (await owner.get('/api/me')).body.member.id;
    executive = (await owner.post('/api/departments', { name: 'مدیریت ارشد' })).body;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی', parentId: executive.id }))
      .body;
  });
  afterAll(() => app?.close());

  it('blocks an owner without 2FA from everything but /me', async () => {
    const c = client(app, env);
    const { body } = await signupCompany(c);
    await signIn(c, body.username);
    const res = await c.get('/api/departments');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('two_factor_setup_required');
  });

  it('builds the department tree and prevents cycles', async () => {
    const list = await owner.get('/api/departments');
    expect(list.status).toBe(200);
    expect(list.body.map((d: { name: string }) => d.name)).toEqual(
      expect.arrayContaining(['مدیریت ارشد', 'پشتیبانی']),
    );
    const cycle = await owner.patch(`/api/departments/${executive.id}`, { parentId: support.id });
    expect(cycle.status).toBe(400);
    const archiveParent = await owner.post(`/api/departments/${executive.id}/archive`);
    expect(archiveParent.status).toBe(409);
  });

  it('creates a member who must change the temporary password first', async () => {
    const username = `m.${Date.now()}`;
    const created = await owner.post('/api/members', {
      displayName: 'سارا محمدی',
      username,
      title: 'کارشناس پشتیبانی',
      roles: ['member'],
      departments: [{ departmentId: support.id, deptRole: 'member', isPrimary: true }],
      managerId: ownerMemberId,
    });
    expect(created.status).toBe(201);
    expect(created.body.temporaryPassword).toMatch(/^[\w]{4}-[\w]{4}-[\w]{4}$/);
    expect(created.body.member.account.roles).toEqual(['member']);
    expect(created.body.member.account.mustChangePassword).toBe(true);

    const c = client(app, env);
    await signIn(c, username, created.body.temporaryPassword);
    expect((await c.get('/api/me')).body.pending.passwordChange).toBe(true);
    const blocked = await c.get('/api/departments');
    expect(blocked.body.error.code).toBe('password_change_required');
    await c.post('/api/me/password', {
      currentPassword: created.body.temporaryPassword,
      newPassword: PASSWORD,
    });
    expect((await c.get('/api/departments')).status).toBe(200);
  });

  it('a regular member reads the directory without account details and cannot manage', async () => {
    const { c } = await memberSession(app, env, owner, {
      departments: [{ departmentId: support.id, deptRole: 'member', isPrimary: true }],
    });
    const members = await c.get('/api/members');
    expect(members.status).toBe(200);
    expect(members.body[0].account).toBeUndefined();
    expect((await c.get('/api/org-chart')).status).toBe(200);
    expect(
      (await c.post('/api/members', { displayName: 'x', username: 'xx.yy', roles: ['member'] }))
        .status,
    ).toBe(403);
    expect((await c.get('/api/audit-logs')).status).toBe(403);
    expect((await c.post('/api/departments', { name: 'جدید' })).status).toBe(403);
  });

  it('only the owner sets oversight; members of that department gain tenant-wide read', async () => {
    const admin = await memberSession(app, env, owner, { roles: ['admin'] });
    const denied = await admin.c.put(`/api/departments/${executive.id}/oversight`, {
      resources: ['task'],
    });
    expect(denied.status).toBe(403);

    const set = await owner.put(`/api/departments/${executive.id}/oversight`, {
      resources: ['task', 'goal'],
    });
    expect(set.status).toBe(200);
    expect(set.body.oversight).toEqual(['goal', 'task']);

    const exec = await memberSession(app, env, owner, {
      departments: [{ departmentId: executive.id, deptRole: 'member', isPrimary: true }],
    });
    const me = await exec.c.get('/api/me');
    expect(me.body.member.permissions['task.read']).toBe('tenant');
    expect(me.body.member.permissions['leave.read']).toBeUndefined();
  });

  it('protects owners: admins cannot grant ownership or suspend an owner; the last owner stays', async () => {
    const admin = await memberSession(app, env, owner, { roles: ['admin'] });
    const target = await memberSession(app, env, owner, {});
    expect(
      (await admin.c.patch(`/api/members/${target.memberId}`, { roles: ['owner'] })).status,
    ).toBe(403);
    expect((await admin.c.post(`/api/members/${ownerMemberId}/suspend`)).status).toBe(403);
    const demoteSelf = await owner.patch(`/api/members/${ownerMemberId}`, { roles: ['admin'] });
    expect(demoteSelf.status).toBe(409);
  });

  it('prevents reporting loops', async () => {
    const a = await memberSession(app, env, owner, {});
    const b = await memberSession(app, env, owner, { managerId: a.memberId });
    const loop = await owner.patch(`/api/members/${a.memberId}`, { managerId: b.memberId });
    expect(loop.status).toBe(400);
  });

  it('resets a password: old one stops working, the new temporary one must be changed', async () => {
    const m = await memberSession(app, env, owner, {});
    const reset = await owner.post(`/api/members/${m.memberId}/reset-password`);
    expect(reset.status).toBe(201);
    expect((await m.c.get('/api/me')).status).toBe(401);
    const fresh = client(app, env);
    expect((await signIn(fresh, m.username, PASSWORD)).status).toBe(401);
    expect((await signIn(fresh, m.username, reset.body.temporaryPassword)).status).toBe(200);
    expect((await fresh.get('/api/me')).body.pending.passwordChange).toBe(true);
  });

  it('suspends a member: sessions end and sign-in no longer opens the company', async () => {
    const m = await memberSession(app, env, owner, {});
    expect((await owner.post(`/api/members/${m.memberId}/suspend`)).status).toBe(201);
    expect((await m.c.get('/api/me')).status).toBe(401);
    const fresh = client(app, env);
    await signIn(fresh, m.username);
    const res = await fresh.get('/api/departments');
    expect(res.body.error.code).toBe('member_suspended');
    expect((await owner.post(`/api/members/${m.memberId}/activate`)).status).toBe(201);
  });

  it('records sensitive changes in the audit log', async () => {
    const res = await owner.get('/api/audit-logs?limit=100');
    expect(res.status).toBe(200);
    const actions = new Set(res.body.map((e: { action: string }) => e.action));
    for (const action of [
      'tenant.created',
      'department.created',
      'department.oversight_changed',
      'member.created',
      'member.roles_changed',
      'member.password_reset',
      'member.suspended',
    ]) {
      expect(actions).toContain(action);
    }
    const roleChange = res.body.find(
      (e: { action: string }) => e.action === 'member.roles_changed',
    );
    expect(roleChange.actor.displayName).toBeTruthy();
  });

  it("another company cannot see or touch this company's data", async () => {
    const other = await ownerSession(app, env);
    expect((await other.c.get(`/api/members/${ownerMemberId}`)).status).toBe(404);
    expect((await other.c.patch(`/api/departments/${support.id}`, { name: 'hacked' })).status).toBe(
      404,
    );
    const list = await other.c.get('/api/departments');
    expect(list.body.find((d: { id: string }) => d.id === support.id)).toBeUndefined();
    const audit = await other.c.get('/api/audit-logs?limit=100');
    expect(
      audit.body.every((e: { subjectId: string | null }) => e.subjectId !== ownerMemberId),
    ).toBe(true);
  });
});
