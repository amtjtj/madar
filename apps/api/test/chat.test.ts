import { createDb, schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  CHAT_SOCKET,
  REALTIME_PATH,
  type Conversation,
  type ConversationSummary,
  type Message,
  type ChatExport,
  type ChatSearchPage,
  type EvidenceDetail,
  type Evidence,
  type ExportableChannel,
  type MessagePage,
  type MessageTasks,
  type Task,
  type Upload,
  mentionToken,
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

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');

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

  it('a removed member stops receiving live messages; a re-added one is notified again', async () => {
    const group: Conversation = (
      await ali.c.post('/api/conversations/group', {
        title: 'بازگشت',
        memberIds: [maryam.memberId, lead.memberId],
      })
    ).body;
    await send(ali, group.id, 'قبل از حذف');
    await settle();
    const notesFor = (memberId: string) =>
      withTenant(handle.db, { tenantId }, (tx) =>
        tx
          .select()
          .from(s.notifications)
          .where(
            and(eq(s.notifications.recipientId, memberId), eq(s.notifications.subjectId, group.id)),
          ),
      );
    expect(await notesFor(lead.memberId)).toHaveLength(1);

    const forLead = await live(lead);
    const forMaryam = await live(maryam);
    expect(
      (await ali.c.delete(`/api/conversations/${group.id}/members/${lead.memberId}`)).status,
    ).toBe(204);
    await send(ali, group.id, 'بعد از حذف');
    const end = Date.now() + 5000;
    while (!forMaryam.some((m) => m.body === 'بعد از حذف') && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(forMaryam.map((m) => m.body)).toContain('بعد از حذف');
    await new Promise((r) => setTimeout(r, 300));
    expect(forLead.map((m) => m.body)).not.toContain('بعد از حذف');
    expect((await lead.c.get(`/api/conversations/${group.id}/messages`)).status).toBe(404);

    // Back in the group: a fresh notification (not swallowed by the old one), and the history.
    await maryam.c.post(`/api/conversations/${group.id}/members`, { memberIds: [lead.memberId] });
    await send(ali, group.id, 'خوش برگشتی');
    await settle();
    expect(await notesFor(lead.memberId)).toHaveLength(2);
    const page: MessagePage = (await lead.c.get(`/api/conversations/${group.id}/messages`)).body;
    expect(page.items.map((m) => m.body)).toEqual(['قبل از حذف', 'بعد از حذف', 'خوش برگشتی']);
  });

  it('archived projects and departments keep a read-only channel', async () => {
    const project = (
      await lead.c.post('/api/projects', { name: 'بایگانی', memberIds: [ali.memberId] })
    ).body;
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-project/${project.id}`)
    ).body;
    await send(ali, channel.id, 'آخرین پیام');
    expect((await lead.c.post(`/api/projects/${project.id}/archive`)).status).toBe(204);
    const archived = await send(ali, channel.id, 'بعد از بایگانی');
    expect(archived.status).toBe(403);
    expect(archived.body.error.code).toBe('chat_read_only');
    expect(
      ((await ali.c.get(`/api/conversations/${channel.id}`)).body as Conversation).can.post,
    ).toBe(false);
    expect((await ali.c.get(`/api/conversations/${channel.id}/messages`)).status).toBe(200);

    const temp = (await owner.post('/api/departments', { name: 'موقت' })).body;
    const member = await memberSession(app, env, owner, {
      departments: [{ departmentId: temp.id, deptRole: 'member', isPrimary: true }],
    });
    const deptChannel: ConversationSummary = (
      await member.c.get(`/api/conversations/by-department/${temp.id}`)
    ).body;
    expect((await send(member, deptChannel.id, 'سلام')).status).toBe(201);
    expect((await owner.post(`/api/departments/${temp.id}/archive`)).status).toBe(204);
    expect((await send(member, deptChannel.id, 'هنوز؟')).status).toBe(403);
    expect((await member.c.get(`/api/conversations/${deptChannel.id}/messages`)).status).toBe(200);
  });

  it('a read-only company reads chat but cannot post', async () => {
    const dm: Conversation = (
      await ali.c.post('/api/conversations/direct', { memberId: maryam.memberId })
    ).body;
    await send(ali, dm.id, 'پیش از تعلیق');
    loadEnv(); // also reads the repo .env into process.env
    const ownerDb = createDb(process.env.DATABASE_URL ?? '');
    const setStatus = (status: 'active' | 'read_only') =>
      ownerDb.db.update(s.tenants).set({ status }).where(eq(s.tenants.id, tenantId));
    try {
      await setStatus('read_only');
      expect((await maryam.c.get(`/api/conversations/${dm.id}/messages`)).status).toBe(200);
      const denied = await send(maryam, dm.id, 'جواب');
      expect(denied.status).toBe(423);
      expect(denied.body.error.code).toBe('tenant_read_only');
    } finally {
      await setStatus('active');
      await ownerDb.pool.end();
    }
  });

  it('files: readers download them, others and people who left cannot, deleting closes them', async () => {
    const group: Conversation = (
      await ali.c.post('/api/conversations/group', {
        title: 'فایل‌ها',
        memberIds: [maryam.memberId, lead.memberId],
      })
    ).body;
    const empty = await ali.c.post(`/api/conversations/${group.id}/messages`, { body: '  ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('message_empty');

    const up: Upload = (await ali.c.upload('/api/uploads', PDF, 'گزارش.pdf')).body;
    const sent = await ali.c.post(`/api/conversations/${group.id}/messages`, {
      uploadIds: [up.id],
    });
    expect(sent.status).toBe(201);
    const message: Message = sent.body;
    expect(message.body).toBe('');
    expect(message.attachments.map((a) => a.fileName)).toEqual(['گزارش.pdf']);
    const file = `/api/attachments/${up.id}/file`;
    expect((await maryam.c.download(file)).status).toBe(200);
    expect((await marketer.c.download(file)).status).toBe(404);
    expect((await other.download(file)).status).toBe(404);
    // Someone else's upload, or one already attached, cannot be sent again.
    expect(
      (await maryam.c.post(`/api/conversations/${group.id}/messages`, { uploadIds: [up.id] }))
        .status,
    ).toBe(404);
    // The list preview names the file.
    const row = (await list(maryam)).find((c) => c.id === group.id);
    expect(row?.lastMessage?.fileName).toBe('گزارش.pdf');
    // A file goes with its message, not on its own.
    expect((await ali.c.delete(`/api/attachments/${up.id}`)).status).toBe(403);

    await ali.c.delete(`/api/conversations/${group.id}/members/${lead.memberId}`);
    expect((await lead.c.download(file)).status).toBe(404);

    expect((await ali.c.delete(`/api/messages/${message.id}`)).status).toBe(204);
    expect((await maryam.c.download(file)).status).toBe(404);
  });

  it('mentions: only readers are kept, they are told even in a muted channel, once', async () => {
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-department/${support.id}`)
    ).body;
    await maryam.c.put(`/api/conversations/${channel.id}/mute`, { muted: true });
    const body = `${mentionToken(maryam.memberId)} و ${mentionToken(marketer.memberId)} ببینید`;
    const sent: Message = (await send(ali, channel.id, body)).body;
    // The marketer is not in the support channel: plain text, no mention.
    expect(sent.mentions.map((m) => m.id)).toEqual([maryam.memberId]);
    expect(sent.body).not.toContain(marketer.memberId);
    expect(sent.body).toContain(mentionToken(maryam.memberId));
    await settle();
    const mentionsOf = (memberId: string) =>
      withTenant(handle.db, { tenantId }, (tx) =>
        tx
          .select()
          .from(s.notifications)
          .where(
            and(
              eq(s.notifications.recipientId, memberId),
              eq(s.notifications.kind, 'chat_mention'),
              eq(s.notifications.subjectId, channel.id),
            ),
          ),
      );
    expect(await mentionsOf(maryam.memberId)).toHaveLength(1);
    expect(await mentionsOf(marketer.memberId)).toHaveLength(0);
    expect(await mentionsOf(ali.memberId)).toHaveLength(0);
    const row = (await list(maryam)).find((c) => c.id === channel.id);
    expect(row?.unreadMentions).toBe(1);

    // Editing adds a mention: only the new person is told.
    const edited = await ali.c.patch(`/api/messages/${sent.id}`, {
      body: `${body} ${mentionToken(lead.memberId)}`,
    });
    expect(edited.status).toBe(200);
    await settle();
    expect(await mentionsOf(maryam.memberId)).toHaveLength(1);
    expect(await mentionsOf(lead.memberId)).toHaveLength(1);

    // Reading the channel clears the mention and its notification.
    await maryam.c.post(`/api/conversations/${channel.id}/read`, { messageId: sent.id });
    expect((await list(maryam)).find((c) => c.id === channel.id)?.unreadMentions).toBe(0);
    expect((await mentionsOf(maryam.memberId)).every((n) => n.readAt)).toBe(true);
  });

  it('in a direct conversation a mention replaces the message notification', async () => {
    const dm: Conversation = (
      await lead.c.post('/api/conversations/direct', { memberId: viewer.memberId })
    ).body;
    await send(lead, dm.id, `${mentionToken(viewer.memberId)} یک لحظه`);
    await settle();
    const kinds = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select({ kind: s.notifications.kind })
        .from(s.notifications)
        .where(
          and(
            eq(s.notifications.recipientId, viewer.memberId),
            eq(s.notifications.subjectId, dm.id),
          ),
        ),
    );
    expect(kinds.map((k) => k.kind)).toEqual(['chat_mention']);
  });

  it('reactions: on, off, harmless repeats, readers only, delivered live', async () => {
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-department/${support.id}`)
    ).body;
    const sent: Message = (await send(ali, channel.id, 'واکنش بدهید')).body;
    const forAli = await live(ali);
    const react = (p: Person, emoji: string, active: boolean) =>
      p.c.put(`/api/messages/${sent.id}/reactions`, { emoji, active });
    expect((await react(maryam, '👍', true)).status).toBe(200);
    const twice: Message = (await react(maryam, '👍', true)).body;
    expect(twice.reactions).toEqual([
      { emoji: '👍', members: [{ id: maryam.memberId, displayName: expect.any(String) }] },
    ]);
    const end = Date.now() + 5000;
    while (!forAli.some((m) => m.id === sent.id && m.reactions.length) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(forAli.find((m) => m.id === sent.id)?.reactions[0]?.emoji).toBe('👍');
    const off: Message = (await react(maryam, '👍', false)).body;
    expect(off.reactions).toEqual([]);
    expect((await react(maryam, '💩', true)).status).toBe(400);
    // The department viewer reads only.
    const denied = await react(viewer, '👍', true);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('chat_read_only');
    expect((await react(marketer, '👍', true)).status).toBe(404);
    expect(
      (await other.put(`/api/messages/${sent.id}/reactions`, { emoji: '👍', active: true })).status,
    ).toBe(404);
    // A deleted message takes no reactions.
    await ali.c.delete(`/api/messages/${sent.id}`);
    expect((await react(maryam, '🎉', true)).status).toBe(404);
  });

  it('mentions of another company are stripped; a body left empty is refused', async () => {
    const group: Conversation = (
      await ali.c.post('/api/conversations/group', {
        title: 'بیرونی',
        memberIds: [maryam.memberId],
      })
    ).body;
    const only = await send(ali, group.id, mentionToken(otherMemberId));
    expect(only.status).toBe(400);
    expect(only.body.error.code).toBe('message_empty');
    const sent: Message = (await send(ali, group.id, `سلام ${mentionToken(otherMemberId)}`)).body;
    expect(sent.mentions).toEqual([]);
    expect(sent.body).toBe('سلام');
    await settle();
    const notes = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select({ kind: s.notifications.kind })
        .from(s.notifications)
        .where(
          and(eq(s.notifications.subjectId, group.id), eq(s.notifications.kind, 'chat_mention')),
        ),
    );
    expect(notes).toHaveLength(0);
  });

  it('someone who turned mention notifications off still hears about the message', async () => {
    const group: Conversation = (
      await lead.c.post('/api/conversations/group', { title: 'بی‌منشن', memberIds: [ali.memberId] })
    ).body;
    await ali.c.put('/api/me/notification-preferences', {
      mutedKinds: ['chat_mention'],
      offHours: true,
    });
    try {
      await send(lead, group.id, `${mentionToken(ali.memberId)} فوری`);
      await settle();
      const kinds = await withTenant(handle.db, { tenantId }, (tx) =>
        tx
          .select({ kind: s.notifications.kind })
          .from(s.notifications)
          .where(
            and(
              eq(s.notifications.recipientId, ali.memberId),
              eq(s.notifications.subjectId, group.id),
            ),
          ),
      );
      expect(kinds.map((k) => k.kind)).toEqual(['chat_message']);
    } finally {
      await ali.c.put('/api/me/notification-preferences', { mutedKinds: [], offHours: false });
    }
  });

  it('observers and archived channels take no reactions; a read-only company neither', async () => {
    const project = (
      await lead.c.post('/api/projects', { name: 'واکنش‌ها', memberIds: [ali.memberId] })
    ).body;
    await lead.c.put(`/api/projects/${project.id}/members`, {
      members: [
        { memberId: lead.memberId, role: 'owner' },
        { memberId: ali.memberId, role: 'member' },
        { memberId: maryam.memberId, role: 'observer' },
      ],
    });
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-project/${project.id}`)
    ).body;
    const sent: Message = (await send(ali, channel.id, 'نظر بدهید')).body;
    const react = (p: Person) =>
      p.c.put(`/api/messages/${sent.id}/reactions`, { emoji: '👍', active: true });
    expect((await react(maryam)).status).toBe(403);
    expect((await react(lead)).status).toBe(200);

    loadEnv();
    const ownerDb = createDb(process.env.DATABASE_URL ?? '');
    const setStatus = (status: 'active' | 'read_only') =>
      ownerDb.db.update(s.tenants).set({ status }).where(eq(s.tenants.id, tenantId));
    try {
      await setStatus('read_only');
      expect((await react(ali)).status).toBe(423);
      expect((await ali.c.upload('/api/uploads', PDF, 'x.pdf')).status).toBe(423);
    } finally {
      await setStatus('active');
      await ownerDb.pool.end();
    }

    await lead.c.post(`/api/projects/${project.id}/archive`);
    expect((await react(ali)).status).toBe(403);
  });

  it('a task made from a message: pinned, read through the task only, unpinning closes it', async () => {
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-department/${support.id}`)
    ).body;
    const up: Upload = (await ali.c.upload('/api/uploads', PDF, 'لاگ.pdf')).body;
    const sent: Message = (
      await ali.c.post(`/api/conversations/${channel.id}/messages`, {
        body: `صفحه خطای پرداخت را ${mentionToken(maryam.memberId)} ببیند\nجزئیات در فایل`,
        uploadIds: [up.id],
      })
    ).body;
    // The marketer is not in the channel; she gets the task.
    const made = await ali.c.post(`/api/messages/${sent.id}/task`, {
      title: 'درست کردن صفحه خطای پرداخت',
      assigneeId: marketer.memberId,
    });
    expect(made.status).toBe(201);
    const task: Task = made.body;
    const pins: Evidence[] = (await marketer.c.get(`/api/tasks/${task.id}/evidence`)).body;
    expect(pins).toHaveLength(1);
    expect(pins[0]?.kind).toBe('message');
    expect(pins[0]?.message).toMatchObject({
      conversation: { kind: 'department', title: 'پشتیبانی' },
      attachmentCount: 1,
    });
    expect(pins[0]?.message?.excerpt).toContain('@');
    expect(pins[0]?.message?.excerpt).not.toContain(maryam.memberId);
    const detail: EvidenceDetail = (
      await marketer.c.get(`/api/tasks/${task.id}/evidence/${pins[0]?.id}`)
    ).body;
    expect(detail.messageText).toContain('جزئیات در فایل');
    expect(detail.body).toBeNull();
    const file = `/api/attachments/${up.id}/file`;
    expect((await marketer.c.download(file)).status).toBe(200);
    // Only that message: the conversation stays closed to her.
    expect((await marketer.c.get(`/api/conversations/${channel.id}`)).status).toBe(404);
    expect((await marketer.c.get(`/api/messages/${sent.id}/tasks`)).status).toBe(404);
    const where: MessageTasks = (await ali.c.get(`/api/messages/${sent.id}/tasks`)).body;
    expect(where.visible.map((t) => t.title)).toEqual(['درست کردن صفحه خطای پرداخت']);
    const page: MessagePage = (await ali.c.get(`/api/conversations/${channel.id}/messages`)).body;
    expect(page.items.find((m) => m.id === sent.id)?.pinnedCount).toBe(1);

    // Someone who cannot read the message cannot make a task from it.
    expect((await marketer.c.post(`/api/messages/${sent.id}/task`, { title: 'x' })).status).toBe(
      404,
    );
    // A pin on a task the reader does not see is only counted.
    const secret = (await lead.c.post('/api/projects', { name: 'محرمانه', visibility: 'private' }))
      .body;
    const hiddenTask: Task = (
      await lead.c.post('/api/tasks', { title: 'کار پنهان', projectId: secret.id })
    ).body;
    expect(
      (
        await lead.c.post(`/api/tasks/${hiddenTask.id}/evidence`, {
          kind: 'message',
          subjectId: sent.id,
        })
      ).status,
    ).toBe(201);
    const counted: MessageTasks = (await ali.c.get(`/api/messages/${sent.id}/tasks`)).body;
    expect(counted.hidden).toBe(1);
    expect(counted.visible).toHaveLength(1);

    await ali.c.delete(`/api/tasks/${task.id}/evidence/${pins[0]?.id}`);
    expect((await marketer.c.download(file)).status).toBe(404);
  });

  it('searches only readable conversations, Persian digits too, and opens around a result', async () => {
    const group: Conversation = (
      await ali.c.post('/api/conversations/group', {
        title: 'جست‌وجو',
        memberIds: [maryam.memberId],
      })
    ).body;
    for (let i = 0; i < 30; i++) await send(ali, group.id, `پیام شماره ${i}`);
    const target: Message = (await send(maryam, group.id, 'لینک سرور تست 4021 اینجاست')).body;
    for (let i = 0; i < 30; i++) await send(ali, group.id, `بعدی ${i}`);
    const gone: Message = (await send(ali, group.id, 'سرور تست قدیمی')).body;
    await ali.c.delete(`/api/messages/${gone.id}`);

    const found: ChatSearchPage = (
      await ali.c.get(`/api/chat/search?q=${encodeURIComponent('سرور تست')}`)
    ).body;
    expect(found.items.map((r) => r.message.id)).toEqual([target.id]);
    expect(found.items[0]?.conversation).toMatchObject({ id: group.id, title: 'جست‌وجو' });
    const digits: ChatSearchPage = (
      await ali.c.get(`/api/chat/search?q=${encodeURIComponent('۴۰۲۱')}`)
    ).body;
    expect(digits.items.map((r) => r.message.id)).toEqual([target.id]);
    // And the other way: Latin digits typed, Persian digits written.
    const persian: Message = (await send(maryam, group.id, 'کد پیگیری ۷۷۳۱')).body;
    const latin: ChatSearchPage = (await ali.c.get('/api/chat/search?q=7731')).body;
    expect(latin.items.map((r) => r.message.id)).toEqual([persian.id]);
    const outside: ChatSearchPage = (
      await marketer.c.get(`/api/chat/search?q=${encodeURIComponent('سرور تست')}`)
    ).body;
    expect(outside.items).toEqual([]);
    const elsewhere: ChatSearchPage = (
      await ali.c.get(
        `/api/chat/search?q=${encodeURIComponent('سرور تست')}&conversationId=${support.id}`,
      )
    ).body;
    expect(elsewhere.items).toEqual([]);
    expect((await ali.c.get('/api/chat/search?q=a')).status).toBe(400);

    const around: MessagePage = (
      await ali.c.get(`/api/conversations/${group.id}/messages?around=${target.id}&limit=20`)
    ).body;
    const at = around.items.findIndex((m) => m.id === target.id);
    expect(at).toBe(10);
    expect(around.hasMore).toBe(true);
    expect(around.hasNewer).toBe(true);
  });

  it('exports channels for owners and admins only, never direct or group, and logs it', async () => {
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-department/${support.id}`)
    ).body;
    await send(ali, channel.id, `برای خروجی، ${mentionToken(maryam.memberId)}`);
    const list: ExportableChannel[] = (await owner.get('/api/chat/exports/channels')).body;
    expect(list.find((c) => c.id === channel.id)).toMatchObject({
      kind: 'department',
      title: 'پشتیبانی',
    });
    expect(list.every((c) => c.kind === 'project' || c.kind === 'department')).toBe(true);
    const exported: ChatExport = (await owner.get(`/api/chat/exports/${channel.id}`)).body;
    expect(exported.channel.title).toBe('پشتیبانی');
    const row = exported.rows.find((r) => r.text.startsWith('برای خروجی'));
    expect(row?.text).toContain('@');
    expect(row?.text).not.toContain(maryam.memberId);
    // Nothing from a later day.
    const empty: ChatExport = (await owner.get(`/api/chat/exports/${channel.id}?from=2099-01-01`))
      .body;
    expect(empty.rows).toEqual([]);

    expect((await ali.c.get('/api/chat/exports/channels')).status).toBe(403);
    expect((await ali.c.get(`/api/chat/exports/${channel.id}`)).status).toBe(403);
    const dm: Conversation = (
      await ali.c.post('/api/conversations/direct', { memberId: maryam.memberId })
    ).body;
    expect((await owner.get(`/api/chat/exports/${dm.id}`)).status).toBe(404);
    expect((await other.get(`/api/chat/exports/${channel.id}`)).status).toBe(404);

    const logged = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.auditLogs)
        .where(and(eq(s.auditLogs.action, 'chat.exported'), eq(s.auditLogs.subjectId, channel.id))),
    );
    expect(logged.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(logged[0])).not.toContain('برای خروجی');
  });

  it('message evidence: deleted messages refused, direct talks unnamed, others kept out, one notification', async () => {
    const dm: Conversation = (
      await ali.c.post('/api/conversations/direct', { memberId: maryam.memberId })
    ).body;
    const said: Message = (await send(maryam, dm.id, 'گزارش روزانه را بفرست')).body;
    const task: Task = (
      await ali.c.post(`/api/messages/${said.id}/task`, {
        title: 'فرستادن گزارش روزانه',
        assigneeId: lead.memberId,
      })
    ).body;
    expect(task.evidenceCount).toBe(1);
    const pins: Evidence[] = (await lead.c.get(`/api/tasks/${task.id}/evidence`)).body;
    expect(pins[0]?.message?.conversation).toEqual({ kind: 'direct', title: null });
    await settle();
    const kinds = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select({ kind: s.notifications.kind })
        .from(s.notifications)
        .where(
          and(
            eq(s.notifications.recipientId, lead.memberId),
            eq(s.notifications.subjectId, task.id),
          ),
        ),
    );
    expect(kinds.map((k) => k.kind)).toEqual(['task_assigned']);

    // Another company reaches none of it.
    expect((await other.post(`/api/messages/${said.id}/task`, { title: 'x' })).status).toBe(404);
    expect((await other.get(`/api/messages/${said.id}/tasks`)).status).toBe(404);
    const otherSearch: ChatSearchPage = (
      await other.get(`/api/chat/search?q=${encodeURIComponent('گزارش روزانه')}`)
    ).body;
    expect(otherSearch.items).toEqual([]);
    expect(
      (await other.post(`/api/tasks/${task.id}/evidence`, { kind: 'message', subjectId: said.id }))
        .status,
    ).toBe(404);

    // A deleted message is neither made into a task nor pinned.
    const gone: Message = (await send(maryam, dm.id, 'اشتباه')).body;
    await maryam.c.delete(`/api/messages/${gone.id}`);
    expect((await ali.c.post(`/api/messages/${gone.id}/task`, { title: 'x' })).status).toBe(404);
    expect(
      (await ali.c.post(`/api/tasks/${task.id}/evidence`, { kind: 'message', subjectId: gone.id }))
        .status,
    ).toBe(404);
  });

  it('search ignores the ids inside mentions; exports refuse groups and backward ranges', async () => {
    const group: Conversation = (
      await ali.c.post('/api/conversations/group', { title: 'شناسه', memberIds: [maryam.memberId] })
    ).body;
    await send(ali, group.id, `${mentionToken(maryam.memberId)} سلام`);
    const noisy: ChatSearchPage = (
      await ali.c.get(`/api/chat/search?q=019&conversationId=${group.id}`)
    ).body;
    expect(noisy.items).toEqual([]);
    expect((await owner.get(`/api/chat/exports/${group.id}`)).status).toBe(404);
    const channel: ConversationSummary = (
      await ali.c.get(`/api/conversations/by-department/${support.id}`)
    ).body;
    expect(
      (await owner.get(`/api/chat/exports/${channel.id}?from=2026-10-10&to=2026-10-01`)).status,
    ).toBe(400);
    const exported: ChatExport = (await owner.get(`/api/chat/exports/${channel.id}`)).body;
    expect(exported.truncated).toBe(false);
    expect((await owner.get('/api/me')).body.member.permissions['chat.export']).toBe('tenant');
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
