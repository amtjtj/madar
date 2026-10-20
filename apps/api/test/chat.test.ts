import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  CHAT_SOCKET,
  REALTIME_PATH,
  type Conversation,
  type ConversationSummary,
  type Message,
  type MessagePage,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { and, count, eq, isNull } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { ConsumerRunner } from '../src/events/consumer-runner.service.js';
import { RelayService } from '../src/events/relay.service.js';
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

interface Person {
  c: Client;
  memberId: string;
  username: string;
}

describe.skipIf(!hasDatabase)('chat', () => {
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let handle: DbHandle;
  let url: string;
  let tenantId: string;
  let owner: Client;
  let ownerId: string;
  let lead: Person; // support manager
  let ali: Person; // support
  let maryam: Person; // support
  let viewer: Person; // support viewer
  let marketer: Person; // marketing
  let other: Client; // another company
  let otherMemberId: string;
  let support: { id: string };
  const sockets: Socket[] = [];

  const send = (p: Person, id: string, body: string, replyToId?: string) =>
    p.c.post(`/api/conversations/${id}/messages`, { body, ...(replyToId ? { replyToId } : {}) });
  const list = async (p: Person): Promise<ConversationSummary[]> =>
    (await p.c.get('/api/conversations')).body;

  async function settle() {
    const until = Date.now() + 10_000;
    for (;;) {
      const [pending] = await withTenant(handle.db, { tenantId }, (tx) =>
        tx.select({ n: count() }).from(s.domainEvents).where(isNull(s.domainEvents.publishedAt)),
      );
      if ((pending?.n ?? 0) === 0 || Date.now() > until) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  async function live(p: Person): Promise<Message[]> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in/username')
      .set('Origin', env.AUTH_BASE_URL)
      .send({ username: p.username, password: PASSWORD });
    const cookie = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    const socket = io(url, {
      path: REALTIME_PATH,
      addTrailingSlash: false,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { cookie },
    });
    sockets.push(socket);
    const received: Message[] = [];
    socket.on(CHAT_SOCKET.message, (m: Message) => received.push(m));
    await new Promise<void>((resolve) => socket.on('connect', () => setTimeout(resolve, 300)));
    return received;
  }

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as { port: number }).port}`;
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    ownerId = (await owner.get('/api/me')).body.member.id;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    lead = await memberSession(app, env, owner, { departments: dept(support.id, 'manager') });
    ali = await memberSession(app, env, owner, { departments: dept(support.id) });
    maryam = await memberSession(app, env, owner, { departments: dept(support.id) });
    viewer = await memberSession(app, env, owner, { departments: dept(support.id, 'viewer') });
    marketer = await memberSession(app, env, owner, { departments: dept(marketing.id) });
    const otherSession = await ownerSession(app, env);
    other = otherSession.c;
    otherMemberId = (await other.get('/api/me')).body.member.id;

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-c-'), RELAY_INTERVAL_MS: 100 })
      .compile();
    await worker.init();
    handle = worker.get<DbHandle>(DB_HANDLE);
    worker.get(ConsumerRunner).start();
    worker.get(RelayService).start([tenantId]);
  });
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await worker?.close();
    await app?.close();
  });

  it('a project channel follows the project members; observers read, managers outside see nothing', async () => {
    const project = (
      await lead.c.post('/api/projects', {
        name: 'اپ موبایل',
        departmentId: support.id,
        memberIds: [ali.memberId],
      })
    ).body;
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-project/${project.id}`)
    ).body;
    expect(channel).toMatchObject({ kind: 'project', title: 'اپ موبایل' });
    expect((await send(ali, channel.id, 'سلام تیم')).status).toBe(201);

    // Not a member yet: not found, even for the owner.
    expect((await maryam.c.get(`/api/conversations/${channel.id}`)).status).toBe(404);
    expect((await owner.get(`/api/conversations/${channel.id}`)).status).toBe(404);

    // Added as an observer: reads, cannot write.
    await lead.c.put(`/api/projects/${project.id}/members`, {
      members: [
        { memberId: lead.memberId, role: 'owner' },
        { memberId: ali.memberId, role: 'member' },
        { memberId: maryam.memberId, role: 'observer' },
      ],
    });
    const asObserver: Conversation = (await maryam.c.get(`/api/conversations/${channel.id}`)).body;
    expect(asObserver.can.post).toBe(false);
    const denied = await send(maryam, channel.id, 'سلام');
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('chat_read_only');
    const page: MessagePage = (await maryam.c.get(`/api/conversations/${channel.id}/messages`))
      .body;
    expect(page.items.map((m) => m.body)).toEqual(['سلام تیم']);

    // Removed from the project: out of the channel at once.
    await lead.c.put(`/api/projects/${project.id}/members`, {
      members: [
        { memberId: lead.memberId, role: 'owner' },
        { memberId: ali.memberId, role: 'member' },
      ],
    });
    expect((await maryam.c.get(`/api/conversations/${channel.id}/messages`)).status).toBe(404);
  });

  it('a department channel: members write, viewers read, other departments see nothing', async () => {
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-department/${support.id}`)
    ).body;
    expect(channel.kind).toBe('department');
    expect((await send(ali, channel.id, 'شیفت امروز')).status).toBe(201);
    expect((await viewer.c.get(`/api/conversations/${channel.id}`)).body.can.post).toBe(false);
    expect((await send(viewer, channel.id, 'x')).status).toBe(403);
    expect((await marketer.c.get(`/api/conversations/${channel.id}`)).status).toBe(404);
  });

  it('a direct conversation is one per pair and private, even from the owner', async () => {
    const first: Conversation = (
      await ali.c.post('/api/conversations/direct', { memberId: maryam.memberId })
    ).body;
    const again: Conversation = (
      await maryam.c.post('/api/conversations/direct', { memberId: ali.memberId })
    ).body;
    expect(again.id).toBe(first.id);
    expect(first.title).toBe((await maryam.c.get('/api/me')).body.member.displayName);
    await send(ali, first.id, 'سلام مریم');
    expect((await owner.get(`/api/conversations/${first.id}/messages`)).status).toBe(404);
    expect((await lead.c.get(`/api/conversations/${first.id}`)).status).toBe(404);
    expect((await ali.c.post('/api/conversations/direct', { memberId: ali.memberId })).status).toBe(
      400,
    );
  });

  it('groups: create, add, remove, rename, leave, and the owner hands over', async () => {
    const group: Conversation = (
      await ali.c.post('/api/conversations/group', {
        title: 'شیفت صبح',
        memberIds: [maryam.memberId],
      })
    ).body;
    expect(group.can).toMatchObject({ manage: true, addMembers: true, leave: true });
    expect(group.members.map((m) => m.id)).toEqual([ali.memberId, maryam.memberId]);

    // Any member adds people; only the owner renames and removes.
    expect(
      (
        await maryam.c.post(`/api/conversations/${group.id}/members`, {
          memberIds: [lead.memberId],
        })
      ).status,
    ).toBe(200);
    const rename = await maryam.c.patch(`/api/conversations/${group.id}`, { title: 'x' });
    expect(rename.status).toBe(403);
    expect(rename.body.error.code).toBe('group_owner_only');
    expect(
      (await maryam.c.delete(`/api/conversations/${group.id}/members/${lead.memberId}`)).status,
    ).toBe(403);
    expect(
      (await ali.c.patch(`/api/conversations/${group.id}`, { title: 'شیفت صبح ۱' })).status,
    ).toBe(200);

    await send(ali, group.id, 'برای فردا');
    expect(
      (await ali.c.delete(`/api/conversations/${group.id}/members/${lead.memberId}`)).status,
    ).toBe(204);
    expect((await lead.c.get(`/api/conversations/${group.id}/messages`)).status).toBe(404);

    // The owner leaves: Maryam (the longest-standing member) takes over.
    expect((await ali.c.post(`/api/conversations/${group.id}/leave`)).status).toBe(204);
    expect((await ali.c.get(`/api/conversations/${group.id}`)).status).toBe(404);
    expect((await maryam.c.get(`/api/conversations/${group.id}`)).body.can.manage).toBe(true);

    // Nobody from another company.
    expect(
      (
        await maryam.c.post(`/api/conversations/${group.id}/members`, {
          memberIds: [otherMemberId],
        })
      ).status,
    ).toBe(404);
  });

  it('messages: reply in the same conversation, edit and delete within 15 minutes', async () => {
    const dm: Conversation = (
      await ali.c.post('/api/conversations/direct', { memberId: lead.memberId })
    ).body;
    const first: Message = (await send(ali, dm.id, 'گزارش آماده است')).body;
    const reply: Message = (await send(lead, dm.id, 'ممنون', first.id)).body;
    expect(reply.replyTo).toMatchObject({ id: first.id, body: 'گزارش آماده است' });

    const elsewhere: Conversation = (
      await ali.c.post('/api/conversations/direct', { memberId: maryam.memberId })
    ).body;
    expect((await send(ali, elsewhere.id, 'x', first.id)).status).toBe(404);

    const edited = await ali.c.patch(`/api/messages/${first.id}`, {
      body: 'گزارش نهایی آماده است',
    });
    expect(edited.body).toMatchObject({ body: 'گزارش نهایی آماده است' });
    expect(edited.body.editedAt).not.toBeNull();
    expect((await lead.c.patch(`/api/messages/${first.id}`, { body: 'x' })).status).toBe(404);

    // Older than 15 minutes: refused.
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .update(s.messages)
        .set({ createdAt: new Date(Date.now() - 16 * 60_000) })
        .where(eq(s.messages.id, reply.id)),
    );
    const late = await lead.c.delete(`/api/messages/${reply.id}`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('message_edit_window');

    expect((await ali.c.delete(`/api/messages/${first.id}`)).status).toBe(204);
    const page: MessagePage = (await lead.c.get(`/api/conversations/${dm.id}/messages`)).body;
    expect(page.items[0]).toMatchObject({ deleted: true, body: '' });
    expect(page.items[1]?.replyTo).toMatchObject({ deleted: true, body: '' });
    const [stored] = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select({ body: s.messages.body }).from(s.messages).where(eq(s.messages.id, first.id)),
    );
    expect(stored?.body).toBe('');
  });

  it('pages through messages by id', async () => {
    const group: Conversation = (
      await ali.c.post('/api/conversations/group', {
        title: 'صفحه‌ها',
        memberIds: [maryam.memberId],
      })
    ).body;
    for (let i = 0; i < 5; i++) await send(ali, group.id, `پیام ${i}`);
    const last: MessagePage = (await ali.c.get(`/api/conversations/${group.id}/messages?limit=2`))
      .body;
    expect(last.items.map((m) => m.body)).toEqual(['پیام 3', 'پیام 4']);
    expect(last.hasMore).toBe(true);
    const older: MessagePage = (
      await ali.c.get(`/api/conversations/${group.id}/messages?limit=2&before=${last.items[0]?.id}`)
    ).body;
    expect(older.items.map((m) => m.body)).toEqual(['پیام 1', 'پیام 2']);
    const newer: MessagePage = (
      await ali.c.get(`/api/conversations/${group.id}/messages?after=${older.items[0]?.id}`)
    ).body;
    expect(newer.items.map((m) => m.body)).toEqual(['پیام 2', 'پیام 3', 'پیام 4']);
  });

  it('counts unread per person and moves the read mark only forward', async () => {
    const dm: Conversation = (
      await maryam.c.post('/api/conversations/direct', { memberId: viewer.memberId })
    ).body;
    const a: Message = (await send(maryam, dm.id, 'یک')).body;
    const b: Message = (await send(maryam, dm.id, 'دو')).body;
    const row = (await list(viewer)).find((c) => c.id === dm.id);
    expect(row?.unreadCount).toBe(2);
    expect((await list(maryam)).find((c) => c.id === dm.id)?.unreadCount).toBe(0);
    await viewer.c.post(`/api/conversations/${dm.id}/read`, { messageId: b.id });
    await viewer.c.post(`/api/conversations/${dm.id}/read`, { messageId: a.id });
    expect((await list(viewer)).find((c) => c.id === dm.id)?.unreadCount).toBe(0);
    expect(
      (await viewer.c.get('/api/conversations/unread-count')).body.count,
    ).toBeGreaterThanOrEqual(0);

    // Muted conversations stay out of the total.
    await send(maryam, dm.id, 'سه');
    const before = (await viewer.c.get('/api/conversations/unread-count')).body.count;
    await viewer.c.put(`/api/conversations/${dm.id}/mute`, { muted: true });
    expect((await viewer.c.get('/api/conversations/unread-count')).body.count).toBe(before - 1);
  });

  it('notifies once per unread conversation, not for muted ones or channels', async () => {
    const dm: Conversation = (
      await lead.c.post('/api/conversations/direct', { memberId: marketer.memberId })
    ).body;
    await send(lead, dm.id, 'سلام');
    await send(lead, dm.id, 'هستی؟');
    await settle();
    const of = (memberId: string) =>
      withTenant(handle.db, { tenantId }, (tx) =>
        tx
          .select()
          .from(s.notifications)
          .where(
            and(
              eq(s.notifications.recipientId, memberId),
              eq(s.notifications.kind, 'chat_message'),
              eq(s.notifications.subjectId, dm.id),
            ),
          ),
      );
    const notes = await of(marketer.memberId);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.payload).toMatchObject({ data: { direct: 1 } });
    expect(await of(lead.memberId)).toHaveLength(0);

    // Reading clears it; a new burst gives a new one.
    const page: MessagePage = (await marketer.c.get(`/api/conversations/${dm.id}/messages`)).body;
    await marketer.c.post(`/api/conversations/${dm.id}/read`, {
      messageId: page.items.at(-1)?.id,
    });
    expect((await of(marketer.memberId)).every((n) => n.readAt)).toBe(true);
    await send(lead, dm.id, 'یک سوال دیگر');
    await settle();
    expect(await of(marketer.memberId)).toHaveLength(2);

    // Muted: nothing more.
    await marketer.c.put(`/api/conversations/${dm.id}/mute`, { muted: true });
    const latest: MessagePage = (await marketer.c.get(`/api/conversations/${dm.id}/messages`)).body;
    await marketer.c.post(`/api/conversations/${dm.id}/read`, {
      messageId: latest.items.at(-1)?.id,
    });
    await send(lead, dm.id, 'بی‌صدا');
    await settle();
    expect(await of(marketer.memberId)).toHaveLength(2);

    // A channel message notifies nobody.
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-department/${support.id}`)
    ).body;
    await send(ali, channel.id, 'خبر کانال');
    await settle();
    const channelNotes = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.notifications).where(eq(s.notifications.subjectId, channel.id)),
    );
    expect(channelNotes).toHaveLength(0);
  });

  it('delivers a message live only to the people who may read it', async () => {
    const group: Conversation = (
      await ali.c.post('/api/conversations/group', { title: 'زنده', memberIds: [maryam.memberId] })
    ).body;
    const forMaryam = await live(maryam);
    const forLead = await live(lead);
    await send(ali, group.id, 'پیام زنده');
    const end = Date.now() + 5000;
    while (!forMaryam.some((m) => m.body === 'پیام زنده') && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(forMaryam.map((m) => m.body)).toContain('پیام زنده');
    await new Promise((r) => setTimeout(r, 300));
    expect(forLead.map((m) => m.body)).not.toContain('پیام زنده');
  });

  it('keeps other companies out', async () => {
    const dm: Conversation = (
      await ali.c.post('/api/conversations/direct', { memberId: maryam.memberId })
    ).body;
    expect((await other.get(`/api/conversations/${dm.id}`)).status).toBe(404);
    expect((await other.get(`/api/conversations/${dm.id}/messages`)).status).toBe(404);
    expect((await other.post(`/api/conversations/${dm.id}/messages`, { body: 'x' })).status).toBe(
      404,
    );
    expect(
      (await ali.c.post('/api/conversations/direct', { memberId: otherMemberId })).status,
    ).toBe(404);
    expect(
      (await ali.c.post('/api/conversations/group', { title: 'x', memberIds: [otherMemberId] }))
        .status,
    ).toBe(404);
    expect(ownerId).toBeDefined();
  });
});
