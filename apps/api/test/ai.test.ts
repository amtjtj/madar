import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  isWorkingDay,
  DEFAULT_WORK_CALENDAR,
  weekStartOf,
  weeklyReport,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiClient } from '../src/ai/ai-client.js';
import { ReportSummaryJob } from '../src/ai/summary-job.js';
import { DB_HANDLE } from '../src/database/tokens.js';
import { buildWeeklyReport } from '../src/reports/builder.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

const TOKEN = 'test-ai-token-0123456789';

/** A stand-in for apps/ai: answers like it, and keeps every request it got. */
function fakeAiService() {
  const requests: Array<{ path: string; auth: string; body: Record<string, unknown> }> = [];
  const state = { mode: 'ok' as 'ok' | 'down' | 'bad', summary: 'این هفته کارها خوب پیش رفت.' };
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += String(chunk)));
      req.on('end', () => resolve(data));
    });
  const server: Server = createServer(async (req, res) => {
    const body = JSON.parse((await read(req)) || '{}') as Record<string, unknown>;
    requests.push({ path: req.url ?? '', auth: req.headers.authorization ?? '', body });
    res.setHeader('content-type', 'application/json');
    if (state.mode !== 'ok') {
      res.statusCode = state.mode === 'down' ? 503 : 502;
      res.end(
        JSON.stringify({ error: { code: state.mode === 'down' ? 'ai_unavailable' : 'ai_failed' } }),
      );
      return;
    }
    if (req.url === '/v1/task-breakdown') {
      res.end(
        JSON.stringify({
          tasks: [
            { title: 'تعیین بودجه کمپین', dueInDays: 1 },
            { title: 'طراحی بنر', dueInDays: null },
          ],
          model: 'fake',
          tokens: 10,
        }),
      );
      return;
    }
    res.end(JSON.stringify({ text: state.summary, model: 'fake', tokens: 10 }));
  });
  return { server, requests, state };
}

describe.skipIf(!hasDatabase)('assistant', () => {
  const ai = fakeAiService();
  let app: NestExpressApplication;
  let bare: NestExpressApplication; // a server without the AI service
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let head: { c: Client; memberId: string };
  let agent: { c: Client; memberId: string };
  let outsider: { c: Client; memberId: string };
  let support: { id: string; name: string };
  let other: Client;
  const lastWeek = addDays(weekStartOf(calendarDateIn(new Date(), 'Asia/Tehran')), -7);

  beforeAll(async () => {
    await new Promise<void>((resolve) => ai.server.listen(0, '127.0.0.1', resolve));
    const { port } = ai.server.address() as AddressInfo;
    let env;
    ({ app, env } = await createTestApp({
      AI_SERVICE_URL: `http://127.0.0.1:${port}`,
      AI_SERVICE_TOKEN: TOKEN,
    }));
    ({ app: bare } = await createTestApp({ AI_SERVICE_URL: '' }));
    handle = app.get<DbHandle>(DB_HANDLE);
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    head = await memberSession(app, env, owner, {
      displayName: 'مریم احمدی',
      departments: dept(support.id, 'head'),
    });
    agent = await memberSession(app, env, owner, {
      displayName: 'علی رضایی',
      departments: dept(support.id),
    });
    outsider = await memberSession(app, env, owner, {
      displayName: 'شیوا کاظمی',
      departments: dept(marketing.id),
    });
    other = (await ownerSession(app, env)).c;
  });
  afterAll(async () => {
    await app?.close();
    await bare?.close();
    await new Promise((resolve) => ai.server.close(resolve));
  });

  const breakdown = (c: Client, departmentId = support.id) =>
    c.post('/api/ai/task-breakdown', { sentence: 'کمپین یلدا را راه بینداز', departmentId });

  it('is off until the company turns it on, and only an admin may (audited)', async () => {
    expect((await agent.c.get('/api/ai/status')).body).toEqual({ available: true, enabled: false });
    const off = await breakdown(agent.c);
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('ai_disabled');

    expect((await agent.c.put('/api/settings/ai', { enabled: true })).status).toBe(403);
    expect((await owner.put('/api/settings/ai', { enabled: true })).status).toBe(200);
    expect((await agent.c.get('/api/ai/status')).body.enabled).toBe(true);
    const audit = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.auditLogs).where(eq(s.auditLogs.action, 'ai_settings.updated')),
    );
    expect(audit[0]?.after).toEqual({ enabled: true });
    // Another company is not touched.
    expect((await other.get('/api/ai/status')).body.enabled).toBe(false);
  });

  it('suggests tasks from a sentence: only the sentence, the department and today go out', async () => {
    ai.requests.length = 0;
    const res = await breakdown(agent.c);
    expect(res.status).toBe(201);
    expect(res.body.tasks).toHaveLength(2);
    const [first, second] = res.body.tasks as Array<{ title: string; dueOn: string | null }>;
    expect(first?.title).toBe('تعیین بودجه کمپین');
    expect(first?.dueOn).not.toBeNull();
    expect(isWorkingDay(DEFAULT_WORK_CALENDAR, first?.dueOn ?? '')).toBe(true);
    expect(second?.dueOn).toBeNull();

    const sent = ai.requests[0];
    expect(sent?.path).toBe('/v1/task-breakdown');
    expect(sent?.auth).toBe(`Bearer ${TOKEN}`);
    expect(Object.keys(sent?.body ?? {}).sort()).toEqual(['department', 'sentence', 'today']);
    expect(sent?.body.department).toBe('پشتیبانی');
    const raw = JSON.stringify(sent?.body);
    for (const name of ['مریم احمدی', 'علی رضایی', 'شیوا کاظمی']) expect(raw).not.toContain(name);
  });

  it('refuses a department you cannot add work to, or one that does not exist', async () => {
    expect((await breakdown(outsider.c)).status).toBe(403);
    expect((await breakdown(agent.c, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect(
      (await agent.c.post('/api/ai/task-breakdown', { sentence: 'ab', departmentId: support.id }))
        .status,
    ).toBe(400);
  });

  it('masks a member named in a title, and treats a malformed reply as a failure', async () => {
    const { reportFacts, maskNames } = await import('../src/ai/facts.js');
    expect(maskNames('پیگیری حقوق علی رضایی', ['علی رضایی', 'ab'])).toBe('پیگیری حقوق …');
    const facts = reportFacts(
      {
        version: 1,
        scope: 'department',
        department: { id: support.id, name: 'پشتیبانی' },
        weekStart: lastWeek,
        weekEnd: addDays(lastWeek, 6),
        generatedAt: new Date().toISOString(),
        partial: false,
        totals: { done: 1, created: 1, overdue: 0 },
        previous: { done: 0, created: 0, overdue: null },
        departments: [],
        goals: [],
        keyResults: [],
        atRiskProjects: [],
        highlights: [
          {
            id: support.id,
            title: 'تماس با مریم احمدی',
            weight: 1,
            department: { id: support.id, name: 'پشتیبانی' },
            assignee: { id: head.memberId, displayName: 'مریم احمدی' },
          },
        ],
        stuck: [],
      },
      'زرین',
      ['مریم احمدی'],
    );
    expect(facts.highlights).toEqual(['تماس با …']);
    expect(JSON.stringify(facts)).not.toContain('مریم');
  });

  it('says when the service is down or answers badly, and when this server has none', async () => {
    ai.state.mode = 'down';
    const down = await breakdown(agent.c);
    expect([down.status, down.body.error.code]).toEqual([503, 'ai_unavailable']);
    ai.state.mode = 'bad';
    const bad = await breakdown(agent.c);
    expect([bad.status, bad.body.error.code]).toEqual([502, 'ai_failed']);
    ai.state.mode = 'ok';

    const { env } = { env: (await import('../src/config/env.js')).loadEnv() };
    const owner2 = await ownerSession(bare, { ...env, AI_SERVICE_URL: '' });
    expect((await owner2.c.get('/api/ai/status')).body).toEqual({
      available: false,
      enabled: false,
    });
  });

  it('summarises a stored report once, from facts without people, for its readers only', async () => {
    // Last week's department and company snapshots, as the weekly job stores them.
    const reportIds = await withTenant(handle.db, { tenantId }, async (tx) => {
      const ids: string[] = [];
      for (const target of [
        { scope: 'department' as const, department: support },
        { scope: 'company' as const, department: null },
      ]) {
        const data = weeklyReport.parse(
          await buildWeeklyReport(tx, { tenantId, ...target, weekStart: lastWeek }),
        );
        const [row] = await tx
          .insert(s.weeklyReports)
          .values({
            scope: target.scope,
            departmentId: target.department?.id ?? null,
            weekStart: lastWeek,
            data: data as unknown as Record<string, unknown>,
          })
          .returning({ id: s.weeklyReports.id });
        ids.push(row?.id ?? '');
      }
      return ids;
    });
    const job = new ReportSummaryJob(handle, app.get(AiClient));

    // A draft that names someone is dropped.
    const now = new Date();
    ai.state.summary = 'علی رضایی این هفته کم کار کرد.';
    expect(await job.runForTenant(tenantId, now)).toBe(0);
    // Pending meanwhile: a recent report the assistant will still summarise.
    const pendingQuery = `scope=department&departmentId=${support.id}&week=${lastWeek}`;
    expect((await head.c.get(`/api/reports/weekly/summary?${pendingQuery}`)).body).toEqual({
      summary: null,
      pending: true,
    });
    ai.state.summary = 'این هفته کارها خوب پیش رفت.';
    ai.requests.length = 0;
    // A dropped draft waits before the next try.
    expect(await job.runForTenant(tenantId, now)).toBe(0);
    expect(ai.requests).toHaveLength(0);
    const later = new Date(now.getTime() + 60 * 60_000);
    expect(await job.runForTenant(tenantId, later)).toBe(2);
    expect(await job.runForTenant(tenantId, later)).toBe(0);
    for (const sent of ai.requests) {
      expect(sent.path).toBe('/v1/report-summary');
      const raw = JSON.stringify(sent.body);
      for (const name of ['مریم احمدی', 'علی رضایی', 'شیوا کاظمی']) expect(raw).not.toContain(name);
      expect(raw).not.toContain('assignee');
    }
    const stored = await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .select()
        .from(s.reportSummaries)
        .where(and(eq(s.reportSummaries.reportId, reportIds[0] ?? ''))),
    );
    expect(stored[0]?.model).toBe('fake');

    const query = `scope=department&departmentId=${support.id}&week=${lastWeek}`;
    const forHead = await head.c.get(`/api/reports/weekly/summary?${query}`);
    expect(forHead.status).toBe(200);
    expect(forHead.body.summary.text).toBe('این هفته کارها خوب پیش رفت.');
    expect((await agent.c.get(`/api/reports/weekly/summary?${query}`)).status).toBe(403);
    expect((await other.get(`/api/reports/weekly/summary?${query}`)).status).not.toBe(200);
    expect(
      (await owner.get(`/api/reports/weekly/summary?scope=company&week=${lastWeek}`)).body.summary
        .text,
    ).toBe('این هفته کارها خوب پیش رفت.');

    // Turned off: the summary is not shown.
    await owner.put('/api/settings/ai', { enabled: false });
    expect((await head.c.get(`/api/reports/weekly/summary?${query}`)).body).toEqual({
      summary: null,
      pending: false,
    });
  });
});

describe('assistant limiter', () => {
  it('never counts a refused request against the company', async () => {
    const { AiLimiter } = await import('../src/ai/limiter.js');
    const limiter = new AiLimiter(2, 3);
    limiter.take('t', 'spammer', 0);
    limiter.take('t', 'spammer', 0);
    for (let i = 0; i < 5; i++) expect(() => limiter.take('t', 'spammer', 0)).toThrow();
    expect(() => limiter.take('t', 'other', 0)).not.toThrow();
  });

  it('allows ten a minute per person and sixty per company', async () => {
    const { AiLimiter } = await import('../src/ai/limiter.js');
    const limiter = new AiLimiter(10, 60);
    for (let i = 0; i < 10; i++) limiter.take('t', 'm', 0);
    expect(() => limiter.take('t', 'm', 0)).toThrow();
    expect(() => limiter.take('t', 'm', 60_001)).not.toThrow();
    const company = new AiLimiter(100, 3);
    for (const m of ['a', 'b', 'c']) company.take('t', m, 0);
    expect(() => company.take('t', 'd', 0)).toThrow();
    expect(() => company.take('u', 'd', 0)).not.toThrow();
  });
});
