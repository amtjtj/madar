import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  persianWeekdayOfCalendarDate,
  type CalendarRange,
  type RequestDetail,
  type RequestSummary,
} from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_HANDLE } from '../src/database/tokens.js';
import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');

interface Person {
  c: Client;
  memberId: string;
}

/** The next Saturday-to-Wednesday stretch with no Friday in it (Fridays are off by default). */
function workingStretch(from: string): { start: string; end: string } {
  let start = addDays(from, 7);
  while (persianWeekdayOfCalendarDate(start) !== 0) start = addDays(start, 1);
  return { start, end: addDays(start, 2) };
}

describe.skipIf(!hasDatabase)('requests and approvals (ADR 0028)', () => {
  let app: NestExpressApplication;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let ownerId: string;
  let maryam: Person; // support head, Ali's manager
  let ali: Person;
  let zahra: Person; // support, no manager of her own
  let reza: Person; // marketing
  let hr: Person; // hr_manager role
  let director: Person; // oversight over approvals
  let other: Client;
  const today = calendarDateIn(new Date(), 'Asia/Tehran');
  const stretch = workingStretch(today);

  beforeAll(async () => {
    let env;
    ({ app, env } = await createTestApp());
    handle = app.get<DbHandle>(DB_HANDLE);
    const session = await ownerSession(app, env);
    owner = session.c;
    tenantId = session.tenantId;
    ownerId = (await owner.get('/api/me')).body.member.id;
    const support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const office = (await owner.post('/api/departments', { name: 'دفتر' })).body;
    await owner.put(`/api/departments/${office.id}/oversight`, { resources: ['approval'] });
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
      managerId: maryam.memberId,
    });
    zahra = await memberSession(app, env, owner, {
      displayName: 'زهرا محمدی',
      departments: dept(support.id),
    });
    reza = await memberSession(app, env, owner, { departments: dept(marketing.id) });
    hr = await memberSession(app, env, owner, { roles: ['hr_manager'], departments: [] });
    director = await memberSession(app, env, owner, { departments: dept(office.id) });
    other = (await ownerSession(app, env)).c;
  });
  afterAll(() => app?.close());

  let leave: RequestDetail;

  it('shows where a request goes before it is made', async () => {
    const route = (p: Person, q: string) =>
      p.c
        .get(`/api/requests/route?${q}`)
        .then((r) => r.body.approvers.map((a: { id: string }) => a.id));
    expect(await route(ali, 'kind=leave')).toEqual([maryam.memberId]);
    // No manager of her own: the department head.
    expect(await route(zahra, 'kind=general')).toEqual([maryam.memberId]);
    // Over the company threshold (10 million tomans by default): the leadership too.
    expect(await route(zahra, 'kind=expense&amountToman=18000000')).toEqual([
      maryam.memberId,
      ownerId,
    ]);
    expect(await route(zahra, 'kind=expense&amountToman=5000000')).toEqual([maryam.memberId]);
    // The head herself goes to the leadership.
    expect(await route(maryam, 'kind=leave')).toEqual([ownerId]);
  });

  it('a leave goes to the manager; only the right people see it', async () => {
    const res = await ali.c.post('/api/requests', {
      kind: 'leave',
      data: { kind: 'daily', startsOn: stretch.start, endsOn: stretch.end, note: 'سفر' },
    });
    expect(res.status).toBe(201);
    leave = res.body;
    expect(leave).toMatchObject({
      status: 'pending',
      waitingOn: { id: maryam.memberId },
      leaveDays: 3,
      can: { decide: false, cancel: true },
    });
    expect((await maryam.c.get('/api/requests/counts')).body).toEqual({ pending: 1 });
    const inbox = (await maryam.c.get('/api/requests?box=pending')).body as RequestSummary[];
    expect(inbox.map((r) => r.id)).toEqual([leave.id]);
    expect((await maryam.c.get(`/api/requests/${leave.id}`)).body.can.decide).toBe(true);
    // A colleague, another department, another company: not found. HR and oversight: yes.
    expect((await zahra.c.get(`/api/requests/${leave.id}`)).status).toBe(404);
    expect((await reza.c.get(`/api/requests/${leave.id}`)).status).toBe(404);
    expect((await other.get(`/api/requests/${leave.id}`)).status).toBe(404);
    expect((await hr.c.get(`/api/requests/${leave.id}`)).status).toBe(200);
    expect((await director.c.get(`/api/requests/${leave.id}`)).status).toBe(200);
  });

  it('is decided by the approver only, with a reason to reject, and makes the leave', async () => {
    expect(
      (await ali.c.post(`/api/requests/${leave.id}/decide`, { decision: 'approved' })).status,
    ).toBe(403);
    expect(
      (await zahra.c.post(`/api/requests/${leave.id}/decide`, { decision: 'approved' })).status,
    ).toBe(404);
    // The leadership stands in only for an approver who is gone.
    expect(
      (await owner.post(`/api/requests/${leave.id}/decide`, { decision: 'approved' })).status,
    ).toBe(403);
    const bare = await maryam.c.post(`/api/requests/${leave.id}/decide`, { decision: 'rejected' });
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe('comment_required');
    const ok = await maryam.c.post(`/api/requests/${leave.id}/decide`, {
      decision: 'approved',
      comment: 'خوش بگذرد',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', waitingOn: null });
    expect(ok.body.steps[0]).toMatchObject({
      approver: { id: maryam.memberId },
      decision: 'approved',
      comment: 'خوش بگذرد',
    });
    const again = await maryam.c.post(`/api/requests/${leave.id}/decide`, { decision: 'approved' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('request_closed');
    // The leave is on Ali's calendar, and on Maryam's view of it; a colleague's view has none.
    const range = (c: Client, member?: string) =>
      c
        .get(
          `/api/calendar?from=${stretch.start}&to=${stretch.end}&layers=leaves${member ? `&member=${member}` : ''}`,
        )
        .then((r) => r.body as CalendarRange);
    const mine = await range(ali.c);
    expect(mine.days.every((d) => d.items.some((i) => i.kind === 'leave'))).toBe(true);
    const asManager = await range(maryam.c, ali.memberId);
    expect(asManager.days[0]?.items.map((i) => i.kind)).toEqual(['leave']);
    // The audit keeps the decision but not the comment.
    const audit = await withTenant(handle.db, { tenantId }, (tx) =>
      tx.select().from(s.auditLogs).where(eq(s.auditLogs.subjectId, leave.id)),
    );
    expect(audit.map((a) => a.action).sort()).toEqual(['request.approved', 'request.submitted']);
    expect(JSON.stringify(audit)).not.toContain('خوش بگذرد');
  });

  it('refuses a leave over an approved one, or one with no working time', async () => {
    const overlap = await ali.c.post('/api/requests', {
      kind: 'leave',
      data: { kind: 'hourly', on: stretch.end, from: '10:00', to: '12:00' },
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('leave_overlap');
    let friday = today;
    while (persianWeekdayOfCalendarDate(friday) !== 6) friday = addDays(friday, 1);
    const off = await ali.c.post('/api/requests', {
      kind: 'leave',
      data: { kind: 'daily', startsOn: friday, endsOn: friday },
    });
    expect(off.status).toBe(400);
    expect(off.body.error.code).toBe('leave_invalid');
  });

  it('an expense over the threshold takes two steps; its invoice is for those who see it', async () => {
    const up = (await zahra.c.upload('/api/uploads', PDF, 'فاکتور.pdf')).body;
    const res = await zahra.c.post('/api/requests', {
      kind: 'expense',
      data: { amountToman: 18_000_000, category: 'equipment', description: 'هدست برای شیفت شب' },
      uploadIds: [up.id],
    });
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    expect(res.body).toMatchObject({ amountToman: 18_000_000, stepCount: 2 });
    expect(res.body.attachments.map((a: { id: string }) => a.id)).toEqual([up.id]);
    const first = await maryam.c.post(`/api/requests/${id}/decide`, { decision: 'approved' });
    expect(first.body).toMatchObject({ status: 'pending', waitingOn: { id: ownerId } });
    expect(
      (await maryam.c.post(`/api/requests/${id}/decide`, { decision: 'approved' })).status,
    ).toBe(403);
    expect((await owner.get('/api/requests/counts')).body.pending).toBeGreaterThanOrEqual(1);
    const file = `/api/attachments/${up.id}/file`;
    expect((await maryam.c.download(file)).status).toBe(200);
    expect((await reza.c.download(file)).status).toBe(404);
    expect((await other.download(file)).status).toBe(404);
    // Nobody deletes a request's file.
    expect((await zahra.c.delete(`/api/attachments/${up.id}`)).status).toBe(403);
    const rejected = await owner.post(`/api/requests/${id}/decide`, {
      decision: 'rejected',
      comment: 'بودجه این فصل تمام شده',
    });
    expect(rejected.body).toMatchObject({ status: 'rejected' });
    const mine = (await zahra.c.get('/api/requests?box=mine')).body as RequestSummary[];
    expect(mine.find((r) => r.id === id)?.status).toBe('rejected');
    const decided = (await maryam.c.get('/api/requests?box=decided')).body as RequestSummary[];
    expect(decided.map((r) => r.id)).toContain(id);
    // HR sees leaves, not expenses.
    expect((await hr.c.get(`/api/requests/${id}`)).status).toBe(404);
  });

  it('the requester cancels an open request; the leadership stands in for a manager who left', async () => {
    const general = (
      await zahra.c.post('/api/requests', {
        kind: 'general',
        title: 'لپ‌تاپ دوم',
        data: { body: 'برای تست اپ موبایل لازم است' },
      })
    ).body;
    expect((await ali.c.post(`/api/requests/${general.id}/cancel`)).status).toBe(404);
    expect((await zahra.c.post(`/api/requests/${general.id}/cancel`)).status).toBe(204);
    expect((await zahra.c.post(`/api/requests/${general.id}/cancel`)).status).toBe(409);

    const waiting = (
      await ali.c.post('/api/requests', {
        kind: 'general',
        title: 'تغییر شیفت',
        data: { body: 'شیفت صبح به عصر' },
      })
    ).body;
    await owner.post(`/api/members/${maryam.memberId}/suspend`);
    const standIn = await owner.post(`/api/requests/${waiting.id}/decide`, {
      decision: 'approved',
    });
    expect(standIn.status).toBe(200);
    expect(standIn.body.steps[0].decidedBy).toMatchObject({ id: ownerId });
    await owner.post(`/api/members/${maryam.memberId}/activate`);
  });

  it('the threshold is the company’s setting; another company reaches none of it', async () => {
    expect(
      (await zahra.c.put('/api/settings/approvals', { expenseThresholdToman: 1 })).status,
    ).toBe(403);
    const set = await owner.put('/api/settings/approvals', { expenseThresholdToman: 50_000_000 });
    expect(set.status).toBe(200);
    const route = (await zahra.c.get('/api/requests/route?kind=expense&amountToman=18000000')).body;
    expect(route.approvers).toHaveLength(1);
    expect((await other.get('/api/settings/approvals')).body.expenseThresholdToman).toBe(
      10_000_000,
    );
    expect((await other.get('/api/requests?box=mine')).body).toEqual([]);
    expect((await other.post(`/api/requests/${leave.id}/cancel`)).status).toBe(404);
    // Someone with no department makes no request.
    const loner = await other.post('/api/requests', {
      kind: 'general',
      title: 'آزمایش',
      data: { body: 'متن آزمایشی' },
    });
    expect(loner.body.error.code).toBe('no_department');
  });
});
