import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { schema as s, withTenant, type DbHandle } from '@madar/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiClient } from '../src/ai/ai-client.js';
import { KnowledgeIndexJob } from '../src/ai/knowledge-job.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

const TOKEN = 'test-ai-token-0123456789';
const DIMENSIONS = 1024;

/** Like apps/ai's fake embedder: a normalised bag of hashed words, so shared words are close. */
function vectorOf(text: string): number[] {
  const v = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) {
    const digest = createHash('sha256').update(word).digest();
    const at = digest.readUInt32BE(0) % DIMENSIONS;
    v[at] = (v[at] ?? 0) + 1;
  }
  const norm = Math.hypot(...v);
  if (norm === 0) v[0] = 1;
  return norm === 0 ? v : v.map((x) => x / norm);
}

/** A stand-in for apps/ai's /v1/embed and /v1/answer that keeps every request. */
function fakeAiService() {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const state = { model: 'fake-embed', answer: 'پاسخ بر پایه [1].', down: false };
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += String(chunk)));
      req.on('end', () => resolve(data));
    });
  const server: Server = createServer(async (req, res) => {
    const body = JSON.parse((await read(req)) || '{}') as Record<string, unknown>;
    requests.push({ path: req.url ?? '', body });
    res.setHeader('content-type', 'application/json');
    if (state.down) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: { code: 'ai_unavailable' } }));
      return;
    }
    if (req.url === '/health') {
      res.end(JSON.stringify({ status: 'ok', modelReachable: true, embedModel: state.model }));
      return;
    }
    if (req.url === '/v1/embed') {
      const texts = body.texts as string[];
      res.end(JSON.stringify({ vectors: texts.map(vectorOf), model: state.model }));
      return;
    }
    if (req.url === '/v1/answer') {
      const cited = [...state.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      res.end(JSON.stringify({ text: state.answer, cited, model: 'fake', tokens: 5 }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  return { server, requests, state };
}

interface Person {
  c: Client;
  memberId: string;
}

describe.skipIf(!hasDatabase)('knowledge index and «از مدار بپرس»', () => {
  const ai = fakeAiService();
  let app: NestExpressApplication;
  let handle: DbHandle;
  let job: KnowledgeIndexJob;
  let tenantId: string;
  let owner: Client;
  let maryam: Person; // support head
  let ali: Person; // support
  let reza: Person; // marketing
  let other: { c: Client; tenantId: string }; // another company
  let support: { id: string };

  const embedCalls = () => ai.requests.filter((r) => r.path === '/v1/embed');
  const chunks = (tenant = tenantId) =>
    withTenant(handle.db, { tenantId: tenant }, (tx) =>
      tx
        .select({
          kind: s.knowledgeChunks.sourceType,
          sourceId: s.knowledgeChunks.sourceId,
          day: s.knowledgeChunks.day,
          title: s.knowledgeChunks.title,
          text: s.knowledgeChunks.text,
          updatedAt: s.knowledgeChunks.updatedAt,
        })
        .from(s.knowledgeChunks),
    );
  const patchTask = async (p: Person, id: string, body: Record<string, unknown>) => {
    const { version } = (await p.c.get(`/api/tasks/${id}`)).body as { version: number };
    return p.c.patch(`/api/tasks/${id}`, { version, ...body });
  };
  const textOf = async (sourceId: string) =>
    (await chunks())
      .filter((c) => c.sourceId === sourceId)
      .map((c) => c.text)
      .join('\n');

  beforeAll(async () => {
    await new Promise<void>((resolve) => ai.server.listen(0, '127.0.0.1', resolve));
    const { port } = ai.server.address() as AddressInfo;
    let env;
    ({ app, env } = await createTestApp({
      AI_SERVICE_URL: `http://127.0.0.1:${port}`,
      AI_SERVICE_TOKEN: TOKEN,
      AI_ASK_MAX_DISTANCE: 0.95,
    }));
    handle = app.get<DbHandle>(DB_HANDLE);
    job = new KnowledgeIndexJob(handle, app.get(AiClient));
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    maryam = await memberSession(app, env, owner, {
      displayName: 'مریم احمدی',
      departments: dept(support.id, 'head'),
    });
    ali = await memberSession(app, env, owner, {
      displayName: 'علی رضایی',
      departments: dept(support.id),
    });
    reza = await memberSession(app, env, owner, {
      displayName: 'رضا کریمی',
      departments: dept(marketing.id),
    });
    const second = await ownerSession(app, env);
    other = { c: second.c, tenantId: second.tenantId };
  });
  afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => ai.server.close(resolve));
  });

  // Built in the first test, used by the later ones.
  let task: { id: string };
  let letter: { id: string };
  let confidential: { id: string };
  let draft: { id: string };
  let meeting: { id: string };
  let channelId: string;
  let directId: string;

  it('indexes nothing while the assistant is off', async () => {
    task = (
      await ali.c.post('/api/tasks', {
        title: 'حذف کارمزد خرید خرد طلا',
        description: 'کارمزد خرید زیر یک گرم از اول آبان حذف می‌شود.',
      })
    ).body;
    await ali.c.post(`/api/tasks/${task.id}/comments`, { body: 'نسخه اپ هم به‌روز شود.' });
    expect(await job.runForTenant(tenantId)).toBe(0);
    expect(await chunks()).toHaveLength(0);
    expect(embedCalls()).toHaveLength(0);
  });

  it('indexes tasks, sent letters, minutes and channel days once turned on; never private talk', async () => {
    const letterBody = (text: string) => ({ format: 'lite', text });
    const send = async (input: Record<string, unknown>) => {
      const d = (await maryam.c.post('/api/letters', { body: letterBody('متن'), ...input })).body;
      return (await maryam.c.post(`/api/letters/${d.id}/send`)).body;
    };
    letter = await send({
      subject: 'سیاست تازه کارمزد',
      body: letterBody('کارمزد **خرید خرد** حذف شد.'),
      to: [ali.memberId],
    });
    confidential = await send({
      subject: 'حقوق محرمانه',
      body: letterBody('رقم حقوق'),
      to: [ali.memberId],
      confidential: true,
    });
    draft = (
      await maryam.c.post('/api/letters', {
        subject: 'پیش‌نویس کارمزد',
        body: letterBody('هنوز نه'),
        to: [ali.memberId],
      })
    ).body;
    const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    meeting = (
      await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'بررسی کارمزد',
        startsAt: at(-3),
        endsAt: at(-2),
        agenda: 'قیمت‌گذاری',
        participantIds: [ali.memberId],
      })
    ).body;
    await ali.c.put(`/api/meetings/${meeting.id}/minutes`, {
      body: 'کارمزد خرید زیر یک گرم حذف شد.',
      version: 0,
    });
    await ali.c.post(`/api/meetings/${meeting.id}/decisions`, { text: 'اطلاع‌رسانی به مشتریان' });
    const empty = (
      await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'جلسه بی‌صورت‌جلسه',
        startsAt: at(5),
        endsAt: at(6),
        participantIds: [ali.memberId],
      })
    ).body;
    channelId = (await ali.c.get(`/api/conversations/by-department/${support.id}`)).body.id;
    await ali.c.post(`/api/conversations/${channelId}/messages`, {
      body: `<@${maryam.memberId}> کارمزد خرید خرد از امروز صفر است`,
    });
    directId = (await ali.c.post('/api/conversations/direct', { memberId: maryam.memberId })).body
      .id;
    await ali.c.post(`/api/conversations/${directId}/messages`, { body: 'راز کارمزد بین ما' });

    expect((await owner.put('/api/settings/ai', { enabled: true })).status).toBe(200);
    expect(await job.runForTenant(tenantId)).toBe(4);

    const rows = await chunks();
    const ids = new Set(rows.map((r) => r.sourceId));
    expect(ids).toEqual(new Set([task.id, letter.id, meeting.id, channelId]));
    expect([...ids]).not.toContain(confidential.id);
    expect([...ids]).not.toContain(draft.id);
    expect([...ids]).not.toContain(directId);
    expect([...ids]).not.toContain(empty.id);

    const taskText = await textOf(task.id);
    expect(taskText).toContain('کار: حذف کارمزد خرید خرد طلا');
    expect(taskText).toContain('بخش: پشتیبانی');
    expect(taskText).toContain('علی رضایی: نسخه اپ هم به‌روز شود.');
    expect(await textOf(letter.id)).toContain('کارمزد خرید خرد حذف شد.'); // no ** marks
    expect(await textOf(meeting.id)).toContain('- اطلاع‌رسانی به مشتریان');
    const channel = rows.find((r) => r.sourceId === channelId);
    expect(channel?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(channel?.title).toBe('پشتیبانی');
    // Mentions read as names, never as raw tokens.
    expect(channel?.text).toContain('@مریم احمدی کارمزد');
    expect(channel?.text).not.toContain('<@');
    expect(rows.every((r) => !r.text.includes('راز'))).toBe(true);
  });

  it('does nothing when nothing changed, and only re-stamps when the text is the same', async () => {
    ai.requests.length = 0;
    expect(await job.runForTenant(tenantId)).toBe(0);
    expect(embedCalls()).toHaveLength(0);

    const before = (await chunks()).find((c) => c.sourceId === task.id)?.updatedAt;
    // Priority is not part of the text: newer stamp, same hash, no model call.
    expect((await patchTask(ali, task.id, { priority: 'high' })).status).toBe(200);
    expect(await job.runForTenant(tenantId)).toBe(0);
    expect(embedCalls()).toHaveLength(0);
    const after = (await chunks()).find((c) => c.sourceId === task.id)?.updatedAt;
    expect(after?.getTime() ?? 0).toBeGreaterThan(before?.getTime() ?? Infinity);
  });

  it('re-embeds an edited source and removes deleted ones', async () => {
    ai.requests.length = 0;
    await patchTask(ali, task.id, { title: 'حذف کارمزد خرید زیر یک گرم' });
    expect(await job.runForTenant(tenantId)).toBe(1);
    expect(embedCalls()).toHaveLength(1);
    expect(await textOf(task.id)).toContain('کار: حذف کارمزد خرید زیر یک گرم');

    const removable = (await ali.c.post('/api/tasks', { title: 'کار موقت' })).body;
    await job.runForTenant(tenantId);
    expect((await chunks()).some((c) => c.sourceId === removable.id)).toBe(true);
    expect((await ali.c.delete(`/api/tasks/${removable.id}`)).status).toBe(204);
    await job.runForTenant(tenantId);
    expect((await chunks()).some((c) => c.sourceId === removable.id)).toBe(false);
  });

  it('a channel day disappears with its last message', async () => {
    const project = (
      await maryam.c.post('/api/projects', {
        name: 'پروژه موقت',
        departmentId: support.id,
        memberIds: [ali.memberId],
      })
    ).body;
    const conversation = (await ali.c.get(`/api/conversations/by-project/${project.id}`)).body;
    const message = (
      await ali.c.post(`/api/conversations/${conversation.id}/messages`, { body: 'پیام موقت' })
    ).body;
    await job.runForTenant(tenantId);
    expect((await chunks()).some((c) => c.sourceId === conversation.id)).toBe(true);
    expect((await ali.c.delete(`/api/messages/${message.id}`)).status).toBe(204);
    await job.runForTenant(tenantId);
    expect((await chunks()).some((c) => c.sourceId === conversation.id)).toBe(false);
  });

  const ask = (p: { c: Client }, question: string) => p.c.post('/api/ai/ask', { question });
  const answerCalls = () => ai.requests.filter((r) => r.path === '/v1/answer');

  it('answers from what the person may see, with numbered sources', async () => {
    ai.requests.length = 0;
    const res = await ask(ali, 'کارمزد خرید خرد');
    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('پاسخ بر پایه [1].');
    const ids = res.body.sources.map((x: { id: string }) => x.id);
    expect(ids).toContain(task.id);
    expect(ids).toContain(letter.id);
    expect(ids).toContain(meeting.id);
    expect(ids).toContain(channelId);
    expect(res.body.sources[0]).toMatchObject({ n: 1, cited: true });
    expect(res.body.sources.slice(1).every((x: { cited: boolean }) => !x.cited)).toBe(true);
    const channel = res.body.sources.find((x: { kind: string }) => x.kind === 'channel');
    expect(channel.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(channel.messageId).toEqual(expect.any(String));
    // The model got only the question, today and the found sources.
    const sent = answerCalls()[0]?.body as { question: string; sources: Array<{ n: number }> };
    expect(Object.keys(sent).sort()).toEqual(['question', 'sources', 'today']);
    expect(sent.sources.map((x) => x.n)).toEqual(res.body.sources.map((x: { n: number }) => x.n));
  });

  it('never answers from what the person cannot see', async () => {
    // Marketing sees no support task, letter, meeting or channel: nothing found, no model call.
    ai.requests.length = 0;
    const res = await ask(reza, 'کارمزد خرید خرد');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ answer: null, sources: [] });
    expect(answerCalls()).toHaveLength(0);

    // A private project stays private, even from the owner.
    const secret = (
      await maryam.c.post('/api/projects', {
        name: 'طرح محرمانه',
        departmentId: support.id,
        visibility: 'private',
      })
    ).body;
    const hidden = (
      await maryam.c.post('/api/tasks', { title: 'زعفرانک پنهان', projectId: secret.id })
    ).body;
    await job.runForTenant(tenantId);
    const mine = await ask(maryam, 'زعفرانک پنهان');
    expect(mine.body.sources.map((x: { id: string }) => x.id)).toContain(hidden.id);
    const theirs = await ask({ c: owner }, 'زعفرانک پنهان');
    expect(theirs.body).toEqual({ answer: null, sources: [] });
    expect((await ask(ali, 'زعفرانک پنهان')).body.sources).toEqual([]);

    // Confidential letters and direct messages are never in the index at all.
    expect((await ask(ali, 'رقم حقوق محرمانه')).body.sources).toEqual([]);
    expect(
      (await ask(maryam, 'راز کارمزد بین ما')).body.sources.map((x: { id: string }) => x.id),
    ).not.toContain(directId);
  });

  it('refuses questions that rank or judge people, without calling the model', async () => {
    ai.requests.length = 0;
    const res = await ask(maryam, 'چه کسی از همه کمتر کار کرده؟');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ai_refused');
    expect(ai.requests).toHaveLength(0);
  });

  it('is refused while off, validated, and limited per person', async () => {
    const off = await ask(other, 'کارمزد خرید خرد');
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('ai_disabled');
    expect((await ask(ali, 'ab')).status).toBe(400);
    expect((await ask(ali, 'ک'.repeat(501))).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await ask(reza, `پرسش شماره ${i}`)).status);
    expect(statuses.filter((code) => code === 429).length).toBeGreaterThan(0);
  });

  it('index status is for admins: what is indexed and what is waiting', async () => {
    expect((await ali.c.get('/api/ai/index-status')).status).toBe(403);
    const status = (await owner.get('/api/ai/index-status')).body;
    expect(status.sources).toMatchObject({ letter: 1, meeting: 1, channel: 1 });
    expect(status.sources.task).toBeGreaterThanOrEqual(2);
    expect(status.chunks).toBeGreaterThanOrEqual(5);
    expect(status.pending).toBe(0);
    await ali.c.post('/api/tasks', { title: 'کار تازه در صف' });
    expect((await owner.get('/api/ai/index-status')).body.pending).toBe(1);
    await job.runForTenant(tenantId);
  });

  it('another company has its own index; chunks of an old embedding model are rebuilt', async () => {
    await other.c.put('/api/settings/ai', { enabled: true });
    const theirDepartment = (await other.c.post('/api/departments', { name: 'پشتیبانی' })).body;
    const created = await other.c.post('/api/tasks', {
      title: 'حذف کارمزد خرید خرد طلا',
      departmentId: theirDepartment.id,
    });
    expect(created.status).toBe(201);
    await job.runForTenant(other.tenantId);
    const theirs = await chunks(other.tenantId);
    expect(theirs).toHaveLength(1);
    const mine = await chunks();
    expect(mine.some((c) => theirs.some((t) => t.sourceId === c.sourceId))).toBe(false);
    // The same words find only each company's own sources.
    const theirAnswer = await ask(other, 'حذف کارمزد خرید خرد طلا');
    expect(theirAnswer.body.sources.map((x: { id: string }) => x.id)).toEqual([
      theirs[0]?.sourceId,
    ]);
    const myAnswer = await ask(maryam, 'حذف کارمزد خرید خرد طلا');
    expect(myAnswer.body.sources.map((x: { id: string }) => x.id)).not.toContain(
      theirs[0]?.sourceId,
    );

    ai.state.model = 'fake-embed-2';
    ai.requests.length = 0;
    await job.runForTenant(tenantId);
    const models = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select({ model: s.knowledgeChunks.model }).from(s.knowledgeChunks),
    );
    expect(new Set(models.map((m) => m.model))).toEqual(new Set(['fake-embed-2']));
    ai.state.model = 'fake-embed';
    await job.runForTenant(tenantId);
  });

  it('turning the assistant off clears only this company’s index', async () => {
    const off = await owner.put('/api/settings/ai', { enabled: false });
    expect(off.status).toBe(200);
    expect(await chunks()).toHaveLength(0);
    expect(await chunks(other.tenantId)).toHaveLength(1);
    expect(await job.runForTenant(tenantId)).toBe(0);
    // A direct check through the owner role too: RLS keeps the other company's rows out.
    const visible = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(s.knowledgeChunks)
        .where(and(eq(s.knowledgeChunks.tenantId, other.tenantId))),
    );
    expect(visible[0]?.n).toBe(0);
    await owner.put('/api/settings/ai', { enabled: true });
    await job.runForTenant(tenantId);
    expect((await chunks()).length).toBeGreaterThan(0);
  });
});
