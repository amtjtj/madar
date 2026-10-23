import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { schema as s, withTenant, type DbHandle } from '@madar/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_HANDLE } from '../src/database/tokens.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

const TOKEN = 'test-ai-token-0123456789';

/** A stand-in for apps/ai's /v1/minutes and /v1/letter-reply that keeps every request. */
function fakeAiService() {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
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
    if (req.url === '/v1/minutes') {
      res.end(
        JSON.stringify({
          text: '- صف بررسی شد\n- هماهنگی با فنی',
          decisions: ['هماهنگی با فنی تا پنجشنبه'],
          model: 'fake',
          tokens: 5,
        }),
      );
      return;
    }
    if (req.url === '/v1/letter-reply') {
      res.end(JSON.stringify({ text: 'با سلام و احترام،\n\nموافقم.', model: 'fake', tokens: 5 }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  return { server, requests };
}

interface Person {
  c: Client;
  memberId: string;
}

describe.skipIf(!hasDatabase)('manager assistant drafts (minutes, letter replies)', () => {
  const ai = fakeAiService();
  let app: NestExpressApplication;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let maryam: Person;
  let ali: Person;
  let reza: Person; // marketing, outside everything
  let director: Person; // oversees meetings
  let other: Client;
  const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const lite = (text: string) => ({ format: 'lite', text });
  const last = (path: string) => ai.requests.filter((r) => r.path === path).at(-1)?.body;

  beforeAll(async () => {
    await new Promise<void>((resolve) => ai.server.listen(0, '127.0.0.1', resolve));
    const { port } = ai.server.address() as AddressInfo;
    let env;
    ({ app, env } = await createTestApp({
      AI_SERVICE_URL: `http://127.0.0.1:${port}`,
      AI_SERVICE_TOKEN: TOKEN,
    }));
    handle = app.get<DbHandle>(DB_HANDLE);
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    const support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const management = (await owner.post('/api/departments', { name: 'مدیریت' })).body;
    await owner.put(`/api/departments/${management.id}/oversight`, { resources: ['meeting'] });
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    maryam = await memberSession(app, env, owner, {
      displayName: 'مریم احمدی',
      departments: dept(support.id, 'manager'),
    });
    ali = await memberSession(app, env, owner, {
      displayName: 'علی رضایی',
      departments: dept(support.id),
    });
    reza = await memberSession(app, env, owner, {
      displayName: 'رضا کریمی',
      departments: dept(marketing.id),
    });
    director = await memberSession(app, env, owner, {
      displayName: 'سارا مدیری',
      departments: dept(management.id),
    });
    other = (await ownerSession(app, env)).c;
    // On for the other company too, so its requests reach the checks that matter here.
    await other.put('/api/settings/ai', { enabled: true });
  });
  afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => ai.server.close(resolve));
  });

  let meeting: { id: string };

  it('is refused while the assistant is off', async () => {
    meeting = (
      await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'بررسی صف برداشت',
        startsAt: at(-2),
        endsAt: at(-1),
        agenda: '- صف **امروز**',
        participantIds: [ali.memberId],
      })
    ).body;
    const res = await maryam.c.post('/api/ai/minutes-draft', {
      meetingId: meeting.id,
      notes: 'صف زیاد بود',
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ai_disabled');
    expect(ai.requests).toHaveLength(0);
    expect((await owner.put('/api/settings/ai', { enabled: true })).status).toBe(200);
  });

  it('tidies the writer’s notes from the meeting’s facts only, and saves nothing', async () => {
    const res = await ali.c.post('/api/ai/minutes-draft', {
      meetingId: meeting.id,
      notes: '  صف زیاد بود. علی گفت مشکل از درگاه  ',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      text: '- صف بررسی شد\n- هماهنگی با فنی',
      decisions: ['هماهنگی با فنی تا پنجشنبه'],
    });
    const sent = last('/v1/minutes') as Record<string, string>;
    expect(Object.keys(sent).sort()).toEqual(['agenda', 'date', 'kind', 'notes', 'title']);
    expect(sent.agenda).toBe('- صف امروز');
    expect(sent.notes).toBe('صف زیاد بود. علی گفت مشکل از درگاه');
    // No participant names from the database (only what the writer typed).
    expect(JSON.stringify(sent)).not.toContain('مریم احمدی');
    const stored = await withTenant(handle.db, { tenantId }, async (tx) => ({
      minutes: await tx
        .select()
        .from(s.meetingMinutes)
        .where(eq(s.meetingMinutes.meetingId, meeting.id)),
      decisions: await tx
        .select()
        .from(s.meetingDecisions)
        .where(eq(s.meetingDecisions.meetingId, meeting.id)),
    }));
    expect(stored).toEqual({ minutes: [], decisions: [] });
  });

  it('only for those who write the minutes, on a meeting that is not canceled', async () => {
    const draft = (p: Person | { c: Client }, meetingId = meeting.id) =>
      p.c.post('/api/ai/minutes-draft', { meetingId, notes: 'یادداشت جلسه' });
    expect((await draft(reza)).status).toBe(404);
    // Oversight reads the meeting but does not write its minutes.
    expect((await draft(director)).status).toBe(403);
    expect((await draft({ c: other })).status).toBe(404);
    expect((await draft(ali, '00000000-0000-7000-8000-000000000000')).status).toBe(404);
    expect(
      (await ali.c.post('/api/ai/minutes-draft', { meetingId: meeting.id, notes: 'a' })).status,
    ).toBe(400);
    const canceled = (
      await maryam.c.post('/api/meetings', {
        type: 'regular',
        title: 'جلسه لغوشده',
        startsAt: at(3),
        endsAt: at(4),
        participantIds: [ali.memberId],
      })
    ).body;
    await maryam.c.post(`/api/meetings/${canceled.id}/cancel`);
    const res = await draft(ali, canceled.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('meeting_canceled');
  });

  it('drafts a reply to a letter I have, with its visible thread and names for the salutation', async () => {
    const send = async (from: Person, input: Record<string, unknown>) => {
      const d = (await from.c.post('/api/letters', input)).body;
      return (await from.c.post(`/api/letters/${d.id}/send`)).body;
    };
    const first = await send(maryam, {
      subject: 'بودجه آبان',
      body: lite('لطفاً **برآورد** را بفرستید.'),
      to: [ali.memberId],
    });
    const reply = await send(ali, {
      subject: 'پاسخ: بودجه آبان',
      body: lite('تا پنجشنبه می‌فرستم.'),
      to: [maryam.memberId],
      replyToId: first.id,
    });
    const res = await maryam.c.post('/api/ai/letter-reply', {
      letterId: reply.id,
      intent: 'تشکر کن',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ text: 'با سلام و احترام،\n\nموافقم.' });
    const sent = last('/v1/letter-reply') as {
      subject: string;
      body: string;
      sender: string;
      recipient: string;
      thread: Array<{ sender: string; subject: string; body: string }>;
      intent: string;
    };
    expect(sent).toMatchObject({
      subject: 'پاسخ: بودجه آبان',
      body: 'تا پنجشنبه می‌فرستم.',
      sender: 'علی رضایی',
      recipient: 'مریم احمدی',
      intent: 'تشکر کن',
    });
    expect(sent.thread).toEqual([
      { sender: 'مریم احمدی', subject: 'بودجه آبان', body: 'لطفاً برآورد را بفرستید.' },
    ]);

    // Someone who does not have the letter, another company, a draft: not found.
    expect((await reza.c.post('/api/ai/letter-reply', { letterId: reply.id })).status).toBe(404);
    expect((await other.post('/api/ai/letter-reply', { letterId: reply.id })).status).toBe(404);
    const draft = (
      await maryam.c.post('/api/letters', {
        subject: 'پیش‌نویس',
        body: lite('متن'),
        to: [ali.memberId],
      })
    ).body;
    expect((await maryam.c.post('/api/ai/letter-reply', { letterId: draft.id })).status).toBe(404);
  });

  it('never drafts a reply to a confidential letter', async () => {
    const d = (
      await maryam.c.post('/api/letters', {
        subject: 'حقوق',
        body: lite('رقم'),
        to: [ali.memberId],
        confidential: true,
      })
    ).body;
    await maryam.c.post(`/api/letters/${d.id}/send`);
    const before = ai.requests.length;
    const res = await ali.c.post('/api/ai/letter-reply', { letterId: d.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ai_not_for_confidential');
    expect(ai.requests.length).toBe(before);
  });
});
