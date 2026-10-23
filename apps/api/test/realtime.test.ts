import { REALTIME_EVENTS, REALTIME_PATH } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { ConsumerRunner } from '../src/events/consumer-runner.service.js';
import { RelayService } from '../src/events/relay.service.js';
import { memberRoom } from '../src/realtime/rooms.js';
import { WorkerModule } from '../src/worker.module.js';
import {
  createTestApp,
  hasDatabase,
  memberSession,
  ownerSession,
  PASSWORD,
  unique,
  type Client,
} from './helpers.js';

interface Live {
  socket: Socket;
  events: string[];
  disconnected: boolean;
}

describe.skipIf(!hasDatabase)('realtime (Socket.IO)', () => {
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let url: string;
  const sockets: Socket[] = [];

  /** Session cookie for a member (signs in through Better Auth like the browser). */
  async function cookieFor(username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in/username')
      .set('Origin', env.AUTH_BASE_URL)
      .send({ username, password: PASSWORD });
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }

  function connect(cookie?: string, origin?: string): Promise<Live> {
    const socket = io(url, {
      path: REALTIME_PATH,
      addTrailingSlash: false,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    });
    sockets.push(socket);
    const live: Live = { socket, events: [], disconnected: false };
    socket.onAny((event: string) => live.events.push(event));
    return new Promise((resolve) => {
      socket.on('disconnect', () => {
        live.disconnected = true;
        resolve(live);
      });
      socket.on('connect_error', () => {
        live.disconnected = true;
        resolve(live);
      });
      // Server-side room joins happen right after the handshake.
      socket.on('connect', () => setTimeout(() => resolve(live), 300));
    });
  }

  async function until(check: () => boolean, ms = 8000) {
    const end = Date.now() + ms;
    while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    return check();
  }

  let tenantA: string;
  let lead: { c: Client; memberId: string; username: string };
  let agent: { c: Client; memberId: string; username: string };
  let outsider: { c: Client; memberId: string; username: string };
  let ownerA: Client;
  let support: { id: string };
  let memberB: { c: Client; memberId: string; username: string };

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    await app.listen(0);
    const address = app.getHttpServer().address() as { port: number };
    url = `http://localhost:${address.port}`;

    const a = await ownerSession(app, env);
    ownerA = a.c;
    tenantA = a.tenantId;
    support = (await ownerA.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await ownerA.post('/api/departments', { name: 'مارکتینگ' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    lead = await memberSession(app, env, ownerA, { departments: dept(support.id, 'manager') });
    agent = await memberSession(app, env, ownerA, { departments: dept(support.id) });
    outsider = await memberSession(app, env, ownerA, { departments: dept(marketing.id) });

    const b = await ownerSession(app, env);
    const bDept = (await b.c.post('/api/departments', { name: 'پشتیبانی' })).body;
    memberB = await memberSession(app, env, b.c, { departments: dept(bDept.id) });

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-rt-'), RELAY_INTERVAL_MS: 100 })
      .compile();
    await worker.init();
    worker.get(ConsumerRunner).start();
    worker.get(RelayService).start([tenantA, b.tenantId]);
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await worker?.close();
    await app?.close();
  });

  it('refuses a connection without a session', async () => {
    const anonymous = await connect();
    expect(anonymous.disconnected).toBe(true);
  });

  it('refuses a browser connection from another site, even with a valid session', async () => {
    const foreign = await connect(await cookieFor(agent.username), 'https://evil.example');
    expect(foreign.disconnected).toBe(true);
    const ours = await connect(await cookieFor(agent.username), env.AUTH_BASE_URL);
    expect(ours.disconnected).toBe(false);
  });

  it('delivers hints only to the right people of the right company', async () => {
    const agentLive = await connect(await cookieFor(agent.username));
    const leadLive = await connect(await cookieFor(lead.username));
    const outsiderLive = await connect(await cookieFor(outsider.username));
    const otherCompany = await connect(await cookieFor(memberB.username));
    for (const live of [agentLive, leadLive, outsiderLive, otherCompany])
      expect(live.disconnected).toBe(false);

    // A client cannot put itself in someone else's room.
    otherCompany.socket.emit('join', memberRoom(tenantA, agent.memberId));

    await lead.c.post('/api/tasks', { title: 'زنده', assigneeId: agent.memberId });
    expect(await until(() => agentLive.events.includes(REALTIME_EVENTS.notificationsChanged))).toBe(
      true,
    );
    expect(agentLive.events).toContain(REALTIME_EVENTS.workChanged);
    // Same department (the manager) sees the board change, but not the agent's notification.
    expect(await until(() => leadLive.events.includes(REALTIME_EVENTS.workChanged))).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    expect(leadLive.events).not.toContain(REALTIME_EVENTS.notificationsChanged);
    expect(outsiderLive.events).toEqual([]);
    expect(otherCompany.events).toEqual([]);
  });

  it('keeps private-project tasks out of the department room', async () => {
    const agentLive = await connect(await cookieFor(agent.username));
    const leadLive = await connect(await cookieFor(lead.username));
    const project = (
      await ownerA.post('/api/projects', {
        name: 'خصوصی',
        departmentId: support.id,
        visibility: 'private',
        memberIds: [agent.memberId],
      })
    ).body;
    await until(() => agentLive.events.includes(REALTIME_EVENTS.workChanged));
    leadLive.events.length = 0;
    await agent.c.post('/api/tasks', { title: 'محرمانه', projectId: project.id });
    agentLive.events.length = 0;
    expect(await until(() => agentLive.events.includes(REALTIME_EVENTS.workChanged))).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    expect(leadLive.events).not.toContain(REALTIME_EVENTS.workChanged);
  });

  it('adds new project members to the project room without reconnecting', async () => {
    const outsiderLive = await connect(await cookieFor(outsider.username));
    const project = (
      await lead.c.post('/api/projects', { name: 'مشترک', departmentId: support.id })
    ).body;
    await lead.c.put(`/api/projects/${project.id}/members`, {
      members: [{ memberId: outsider.memberId, role: 'member' }],
    });
    expect(await until(() => outsiderLive.events.includes(REALTIME_EVENTS.workChanged))).toBe(true);
    outsiderLive.events.length = 0;
    await lead.c.post('/api/tasks', { title: 'کار پروژه مشترک', projectId: project.id });
    expect(await until(() => outsiderLive.events.includes(REALTIME_EVENTS.workChanged))).toBe(true);
  });

  it('takes removed project members out of the project room', async () => {
    const outsiderLive = await connect(await cookieFor(outsider.username));
    const project = (
      await lead.c.post('/api/projects', {
        name: 'موقت',
        departmentId: support.id,
        visibility: 'private',
        memberIds: [outsider.memberId],
      })
    ).body;
    expect(await until(() => outsiderLive.events.includes(REALTIME_EVENTS.workChanged))).toBe(true);
    await lead.c.put(`/api/projects/${project.id}/members`, { members: [] });
    await until(() => outsiderLive.events.length > 1);
    await new Promise((r) => setTimeout(r, 500));
    outsiderLive.events.length = 0;
    await lead.c.post('/api/tasks', { title: 'بعد از رفتن', projectId: project.id });
    await new Promise((r) => setTimeout(r, 1500));
    expect(outsiderLive.events).not.toContain(REALTIME_EVENTS.workChanged);
  });

  it('reaches everyone for company-wide projects', async () => {
    const outsiderLive = await connect(await cookieFor(outsider.username));
    const project = (
      await lead.c.post('/api/projects', {
        name: 'همه شرکت',
        departmentId: support.id,
        visibility: 'tenant',
      })
    ).body;
    await new Promise((r) => setTimeout(r, 500));
    outsiderLive.events.length = 0;
    await lead.c.post('/api/tasks', { title: 'برای همه', projectId: project.id });
    expect(await until(() => outsiderLive.events.includes(REALTIME_EVENTS.workChanged))).toBe(true);
  });

  it('disconnects a member as soon as they are suspended', async () => {
    const outsiderLive = await connect(await cookieFor(outsider.username));
    expect(outsiderLive.disconnected).toBe(false);
    expect((await ownerA.post(`/api/members/${outsider.memberId}/suspend`)).status).toBe(201);
    expect(await until(() => outsiderLive.disconnected)).toBe(true);
    // And cannot come back.
    const again = await connect(await cookieFor(outsider.username).catch(() => ''));
    expect(again.disconnected).toBe(true);
  });
});
