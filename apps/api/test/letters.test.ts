import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  toJalali,
  toPersianDigits,
  type Letter,
  type LetterList,
  type Upload,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { and, count, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENV } from '../src/config/config.module.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { ConsumerRunner } from '../src/events/consumer-runner.service.js';
import { RelayService } from '../src/events/relay.service.js';
import { FilesCleanupJob } from '../src/files/cleanup-job.js';
import { FILE_STORAGE, type FileStorage } from '../src/files/storage.js';
import { WorkerModule } from '../src/worker.module.js';
import {
  createTestApp,
  hasDatabase,
  memberSession,
  ownerSession,
  unique,
  type Client,
} from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
const body = (text: string) => ({ format: 'lite' as const, text });

describe.skipIf(!hasDatabase)('letters', () => {
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Person;
  let lead: Person; // legal manager
  let ali: Person; // support, the sender
  let legal: Person; // legal expert
  let maryam: Person; // cc
  let reza: Person; // referred later
  let other: Client; // another company
  let otherMemberId: string;

  const year = toJalali(new Date(), 'Asia/Tehran').jy;

  async function draft(from: Person, input: Record<string, unknown>): Promise<Letter> {
    const res = await from.c.post('/api/letters', {
      subject: 'پیگیری قرارداد',
      body: body('سلام\n\n- بند اول\n- **بند دوم**'),
      to: [],
      ...input,
    });
    if (res.status !== 201) throw new Error(`draft failed: ${res.status} ${res.text}`);
    return res.body;
  }

  async function sendLetter(from: Person, input: Record<string, unknown>): Promise<Letter> {
    const d = await draft(from, input);
    const res = await from.c.post(`/api/letters/${d.id}/send`);
    if (res.status !== 200) throw new Error(`send failed: ${res.status} ${res.text}`);
    return res.body;
  }

  const folder = async (p: Person, name: string, q = ''): Promise<LetterList> =>
    (await p.c.get(`/api/letters?folder=${name}${q ? `&q=${encodeURIComponent(q)}` : ''}`)).body;

  const notificationsOf = (memberId: string, kind: string) =>
    withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.notifications)
        .where(and(eq(s.notifications.recipientId, memberId), eq(s.notifications.kind, kind))),
    );

  const auditOf = (letterId: string, action: string) =>
    withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.auditLogs)
        .where(and(eq(s.auditLogs.subjectId, letterId), eq(s.auditLogs.action, action))),
    );

  async function settle() {
    const until = Date.now() + 10_000;
    for (;;) {
      const [pending] = await withTenant(handle.db, { tenantId }, (tx) =>
        tx.select({ n: count() }).from(s.domainEvents).where(isNull(s.domainEvents.publishedAt)),
      );
      if ((pending?.n ?? 0) === 0 || Date.now() > until) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
    const session = await ownerSession(app, env);
    tenantId = session.tenantId;
    const me = (await session.c.get('/api/me')).body;
    owner = { c: session.c, memberId: me.member.id };
    const support = (await owner.c.post('/api/departments', { name: 'پشتیبانی' })).body;
    const legalDept = (await owner.c.post('/api/departments', { name: 'حقوقی' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    lead = await memberSession(app, env, owner.c, { departments: dept(legalDept.id, 'manager') });
    ali = await memberSession(app, env, owner.c, { departments: dept(support.id) });
    legal = await memberSession(app, env, owner.c, { departments: dept(legalDept.id) });
    maryam = await memberSession(app, env, owner.c, { departments: dept(support.id) });
    reza = await memberSession(app, env, owner.c, { departments: dept(legalDept.id) });
    const otherSession = await ownerSession(app, env);
    other = otherSession.c;
    otherMemberId = (await other.get('/api/me')).body.member.id;

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-l-'), RELAY_INTERVAL_MS: 100 })
      .compile();
    await worker.init();
    handle = worker.get<DbHandle>(DB_HANDLE);
    worker.get(ConsumerRunner).start();
    worker.get(RelayService).start([tenantId]);
  });
  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  it('saves a draft only its sender sees, then sends it with the next number', async () => {
    const d = await draft(ali, { to: [lead.memberId], cc: [maryam.memberId, lead.memberId] });
    expect(d).toMatchObject({ number: null, sentAt: null, can: { edit: true, reply: false } });
    // «to» wins over «cc» for the same person.
    expect(d.recipients.map((r) => [r.id, r.kind])).toEqual([
      [lead.memberId, 'to'],
      [maryam.memberId, 'cc'],
    ]);
    expect((await lead.c.get(`/api/letters/${d.id}`)).status).toBe(404);
    expect((await folder(ali, 'drafts')).items.map((l) => l.id)).toContain(d.id);

    const edited = await ali.c.patch(`/api/letters/${d.id}`, {
      subject: 'پیگیری قرارداد پیمانکار',
      body: body('متن تازه'),
      to: [lead.memberId],
      cc: [],
      urgency: 'urgent',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.recipients).toHaveLength(1);

    const sent = await ali.c.post(`/api/letters/${d.id}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.number).toMatch(new RegExp(`^${year}/\\d{5}$`));
    expect(sent.body).toMatchObject({ urgency: 'urgent', can: { edit: false, reply: true } });

    // A sent letter never changes.
    const again = await ali.c.patch(`/api/letters/${d.id}`, {
      subject: 'x',
      body: body(''),
      to: [lead.memberId],
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('letter_sent');
    expect((await ali.c.delete(`/api/letters/${d.id}`)).status).toBe(409);
    expect((await ali.c.post(`/api/letters/${d.id}/send`)).status).toBe(409);
    expect(await auditOf(d.id, 'letter.sent')).toHaveLength(1);
  });

  it('refuses to send without a subject or a «to» recipient; drafts can be deleted', async () => {
    const d = await draft(ali, { to: [], cc: [maryam.memberId] });
    const res = await ali.c.post(`/api/letters/${d.id}/send`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('letter_no_recipients');
    expect((await ali.c.delete(`/api/letters/${d.id}`)).status).toBe(204);
    expect((await ali.c.get(`/api/letters/${d.id}`)).status).toBe(404);
  });

  it("purges a deleted draft's files", async () => {
    const up: Upload = (await ali.c.upload('/api/uploads', PDF, 'پیش‌نویس.pdf')).body;
    const d = await draft(ali, { to: [lead.memberId], uploadIds: [up.id] });
    await ali.c.delete(`/api/letters/${d.id}`);
    expect((await ali.c.download(`/api/attachments/${up.id}/file`)).status).toBe(404);
    const appHandle = app.get<DbHandle>(DB_HANDLE);
    await new FilesCleanupJob(appHandle, app.get<FileStorage>(FILE_STORAGE)).runForTenant(tenantId);
    const [row] = await withTenant(appHandle.db, { tenantId }, (tx) =>
      tx.select().from(s.attachments).where(eq(s.attachments.id, up.id)),
    );
    expect(row?.purgedAt).not.toBeNull();
  });

  it('only the people on a letter see it: not managers, admins or the owner', async () => {
    const letter = await sendLetter(legal, { to: [ali.memberId] });
    expect((await ali.c.get(`/api/letters/${letter.id}`)).status).toBe(200);
    expect((await lead.c.get(`/api/letters/${letter.id}`)).status).toBe(404); // legal's manager
    expect((await owner.c.get(`/api/letters/${letter.id}`)).status).toBe(404);
    expect((await maryam.c.get(`/api/letters/${letter.id}`)).status).toBe(404);
    expect((await folder(owner, 'inbox')).items.map((l) => l.id)).not.toContain(letter.id);
  });

  it('records reading; read state shows to the sender only', async () => {
    const letter = await sendLetter(ali, { to: [lead.memberId], cc: [maryam.memberId] });
    expect((await lead.c.get('/api/letters/unread-count')).body.count).toBeGreaterThan(0);
    const inbox = await folder(lead, 'inbox');
    expect(inbox.items.find((l) => l.id === letter.id)).toMatchObject({
      read: false,
      receivedAs: 'to',
    });
    const before = (await lead.c.get('/api/letters/unread-count')).body.count;
    await lead.c.get(`/api/letters/${letter.id}`);
    expect((await lead.c.get('/api/letters/unread-count')).body.count).toBe(before - 1);

    const forSender: Letter = (await ali.c.get(`/api/letters/${letter.id}`)).body;
    expect(forSender.recipients.find((r) => r.id === lead.memberId)?.readAt).toBeTruthy();
    expect(forSender.recipients.find((r) => r.id === maryam.memberId)?.readAt).toBeNull();

    const forCc: Letter = (await maryam.c.get(`/api/letters/${letter.id}`)).body;
    expect(forCc.recipients.find((r) => r.id === lead.memberId)).not.toHaveProperty('readAt');
    expect((await folder(ali, 'sent')).items[0]).toMatchObject({ id: letter.id, read: true });
  });

  it('replies in a thread; a referral sees the letter but not the rest of the thread', async () => {
    const first = await sendLetter(ali, {
      subject: 'قرارداد پیمانکار',
      to: [lead.memberId],
      cc: [maryam.memberId],
    });
    const reply = await sendLetter(lead, {
      subject: 'پاسخ: قرارداد پیمانکار',
      to: [ali.memberId],
      cc: [maryam.memberId],
      replyToId: first.id,
    });
    expect(reply.threadId).toBe(first.id);
    expect(reply.thread.map((l) => l.id)).toEqual([first.id]);

    const referred = await lead.c.post(`/api/letters/${first.id}/refer`, {
      memberIds: [reza.memberId],
      note: 'لطفاً بررسی و تا شنبه نظر بدهید',
    });
    expect(referred.status).toBe(200);
    const route = (referred.body as Letter).recipients.find((r) => r.id === reza.memberId);
    expect(route).toMatchObject({
      kind: 'referral',
      referredBy: { id: lead.memberId },
      referralNote: 'لطفاً بررسی و تا شنبه نظر بدهید',
      readAt: null, // the referrer sees it
    });

    const forReza: Letter = (await reza.c.get(`/api/letters/${first.id}`)).body;
    expect(forReza.receivedAs).toBe('referral');
    expect(forReza.thread).toEqual([]);
    expect((await reza.c.get(`/api/letters/${reply.id}`)).status).toBe(404);

    // Nobody gets the same letter twice, and only people who see it can refer it.
    const twice = await lead.c.post(`/api/letters/${first.id}/refer`, {
      memberIds: [maryam.memberId],
    });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('already_recipient');
    expect(
      (await owner.c.post(`/api/letters/${first.id}/refer`, { memberIds: [owner.memberId] }))
        .status,
    ).toBe(404);
    expect(await auditOf(first.id, 'letter.referred')).toHaveLength(1);

    // Reza replies; the reply reaches the sender's inbox.
    const answer = await sendLetter(reza, {
      subject: 'پاسخ: قرارداد پیمانکار',
      to: [ali.memberId],
      replyToId: first.id,
    });
    expect((await folder(ali, 'inbox')).items.map((l) => l.id)).toContain(answer.id);
  });

  it('archives for one person only, and searches subject and number', async () => {
    const letter = await sendLetter(ali, {
      subject: 'درخواست خرید لپ‌تاپ',
      to: [lead.memberId, legal.memberId],
    });
    expect((await lead.c.post(`/api/letters/${letter.id}/archive`)).status).toBe(204);
    expect((await folder(lead, 'inbox')).items.map((l) => l.id)).not.toContain(letter.id);
    expect((await folder(lead, 'archive')).items.map((l) => l.id)).toContain(letter.id);
    expect((await folder(legal, 'inbox')).items.map((l) => l.id)).toContain(letter.id);
    expect((await folder(ali, 'sent')).items.map((l) => l.id)).toContain(letter.id);
    await lead.c.post(`/api/letters/${letter.id}/unarchive`);
    expect((await folder(lead, 'inbox')).items.map((l) => l.id)).toContain(letter.id);

    expect((await folder(legal, 'inbox', 'لپ‌تاپ')).items.map((l) => l.id)).toEqual([letter.id]);
    const persianNumber = toPersianDigits(letter.number ?? '');
    expect((await folder(legal, 'inbox', persianNumber)).items.map((l) => l.id)).toEqual([
      letter.id,
    ]);
    expect((await folder(legal, 'inbox', '%')).items).toEqual([]);
  });

  it('pages through a folder', async () => {
    for (let i = 0; i < 3; i++)
      await sendLetter(maryam, { subject: `صفحه ${i}`, to: [reza.memberId] });
    const first = (await reza.c.get('/api/letters?folder=inbox&limit=2')).body as LetterList;
    expect(first.items).toHaveLength(2);
    expect(first.nextBefore).not.toBeNull();
    const second = (
      await reza.c.get(`/api/letters?folder=inbox&limit=2&before=${first.nextBefore}`)
    ).body as LetterList;
    const ids = [...first.items, ...second.items].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("serves a letter's files only to the people on it; sent files cannot be deleted", async () => {
    const up: Upload = (await ali.c.upload('/api/uploads', PDF, 'قرارداد.pdf')).body;
    const d = await draft(ali, { to: [legal.memberId], uploadIds: [up.id] });
    expect(d.attachments.map((a) => [a.fileName, a.can.delete])).toEqual([['قرارداد.pdf', true]]);
    expect((await legal.c.download(`/api/attachments/${up.id}/file`)).status).toBe(404);
    await ali.c.post(`/api/letters/${d.id}/send`);

    expect((await legal.c.download(`/api/attachments/${up.id}/file`)).status).toBe(200);
    expect((await lead.c.download(`/api/attachments/${up.id}/file`)).status).toBe(404);
    expect((await other.download(`/api/attachments/${up.id}/file`)).status).toBe(404);
    expect((await ali.c.delete(`/api/attachments/${up.id}`)).status).toBe(403);
    const list: LetterList = await folder(legal, 'inbox');
    expect(list.items.find((l) => l.id === d.id)?.attachmentCount).toBe(1);
  });

  it('notifies to and cc; a confidential letter keeps its subject out and audits each first open', async () => {
    const plain = await sendLetter(ali, {
      subject: 'جلسه هفتگی',
      to: [lead.memberId],
      cc: [maryam.memberId],
    });
    const secret = await sendLetter(ali, {
      subject: 'افزایش حقوق',
      to: [lead.memberId],
      confidential: true,
    });
    await settle();
    const received = await notificationsOf(lead.memberId, 'letter_received');
    expect(received.find((n) => n.subjectId === plain.id)?.payload).toMatchObject({
      title: 'جلسه هفتگی',
    });
    expect(received.find((n) => n.subjectId === secret.id)?.payload).toEqual({
      title: '',
      data: { confidential: 1, urgency: 'normal' },
    });
    expect(
      (await notificationsOf(maryam.memberId, 'letter_received')).map((n) => n.subjectId),
    ).toContain(plain.id);
    expect(
      (await notificationsOf(ali.memberId, 'letter_received')).map((n) => n.subjectId),
    ).not.toContain(plain.id);

    await lead.c.get(`/api/letters/${secret.id}`);
    await lead.c.get(`/api/letters/${secret.id}`);
    await ali.c.get(`/api/letters/${secret.id}`);
    expect(await auditOf(secret.id, 'letter.confidential_opened')).toHaveLength(1);

    await lead.c.post(`/api/letters/${secret.id}/refer`, { memberIds: [legal.memberId] });
    await settle();
    const referral = await notificationsOf(legal.memberId, 'letter_referred');
    expect(referral.find((n) => n.subjectId === secret.id)?.payload).toMatchObject({ title: '' });
    // The letter.sent event does not notify people referred before it was handled.
    expect(
      (await notificationsOf(legal.memberId, 'letter_received')).map((n) => n.subjectId),
    ).not.toContain(secret.id);
  });

  it('keeps other companies out', async () => {
    const letter = await sendLetter(ali, { to: [lead.memberId] });
    expect((await other.get(`/api/letters/${letter.id}`)).status).toBe(404);
    expect(
      (await other.post(`/api/letters/${letter.id}/refer`, { memberIds: [otherMemberId] })).status,
    ).toBe(404);
    expect((await other.post(`/api/letters/${letter.id}/archive`)).status).toBe(404);
    // A member of another company cannot be a recipient or be referred.
    const res = await ali.c.post('/api/letters', {
      subject: 'x',
      body: body(''),
      to: [otherMemberId],
    });
    expect(res.status).toBe(404);
    expect(
      (await ali.c.post(`/api/letters/${letter.id}/refer`, { memberIds: [otherMemberId] })).status,
    ).toBe(404);
  });

  it('hands out gap-free numbers to parallel sends', async () => {
    const company = await ownerSession(app, env);
    const sender: Person = {
      c: company.c,
      memberId: (await company.c.get('/api/me')).body.member.id,
    };
    const to = await memberSession(app, env, company.c, {});
    const drafts = await Promise.all(
      Array.from({ length: 10 }, () => draft(sender, { to: [to.memberId] })),
    );
    const sent = await Promise.all(drafts.map((d) => sender.c.post(`/api/letters/${d.id}/send`)));
    expect(sent.map((r) => r.status)).toEqual(Array(10).fill(200));
    const numbers = sent.map((r) => (r.body as Letter).number).sort();
    expect(numbers).toEqual(
      Array.from({ length: 10 }, (_, i) => `${year}/${String(i + 1).padStart(5, '0')}`),
    );
  });
});
