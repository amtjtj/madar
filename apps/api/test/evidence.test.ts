import { schema as s, withTenant, type DbHandle } from '@madar/db';
import type {
  Evidence,
  EvidenceAudience,
  EvidenceDetail,
  Letter,
  Task,
  Upload,
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

describe.skipIf(!hasDatabase)('task evidence', () => {
  let app: NestExpressApplication;
  let env: Env;
  let worker: TestingModule;
  let handle: DbHandle;
  let tenantId: string;
  let owner: Client;
  let lead: Person; // support manager, assigns the task, not on the letter
  let ali: Person; // support, does the task and writes the letter
  let maryam: Person; // support member: sees the task, cannot edit it
  let legal: Person; // receives the letter, cannot see the task
  let marketer: Person; // sees neither
  let other: Client; // another company
  let support: { id: string };
  let task: Task;
  let letter: Letter;
  let fileId: string;

  async function sendLetter(from: Person, input: Record<string, unknown>): Promise<Letter> {
    const d = await from.c.post('/api/letters', {
      subject: 'پیگیری قرارداد پیمانکار',
      body: body('لطفاً قرارداد پیوست را بررسی کنید.'),
      to: [],
      ...input,
    });
    if (d.status !== 201) throw new Error(`draft failed: ${d.status} ${d.text}`);
    const sent = await from.c.post(`/api/letters/${d.body.id}/send`);
    if (sent.status !== 200) throw new Error(`send failed: ${sent.status} ${sent.text}`);
    return sent.body;
  }

  const pin = (p: Person, taskId: string, subjectId: string) =>
    p.c.post(`/api/tasks/${taskId}/evidence`, { kind: 'letter', subjectId });

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
    owner = session.c;
    tenantId = session.tenantId;
    support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const legalDept = (await owner.post('/api/departments', { name: 'حقوقی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    lead = await memberSession(app, env, owner, { departments: dept(support.id, 'manager') });
    ali = await memberSession(app, env, owner, { departments: dept(support.id) });
    maryam = await memberSession(app, env, owner, { departments: dept(support.id) });
    legal = await memberSession(app, env, owner, { departments: dept(legalDept.id) });
    marketer = await memberSession(app, env, owner, { departments: dept(marketing.id) });
    other = (await ownerSession(app, env)).c;

    task = (await lead.c.post('/api/tasks', { title: 'پیگیری قرارداد', assigneeId: ali.memberId }))
      .body;
    const up: Upload = (await ali.c.upload('/api/uploads', PDF, 'قرارداد.pdf')).body;
    fileId = up.id;
    letter = await sendLetter(ali, { to: [legal.memberId], uploadIds: [up.id] });

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), QUEUE_PREFIX: unique('test-e-'), RELAY_INTERVAL_MS: 100 })
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

  it('the assignee pins their letter; task viewers see that one letter read-only', async () => {
    const candidates = (await ali.c.get(`/api/tasks/${task.id}/evidence/candidates`)).body;
    expect(candidates.map((l: { id: string }) => l.id)).toContain(letter.id);

    const res = await pin(ali, task.id, letter.id);
    expect(res.status).toBe(201);
    expect(res.body as Evidence).toMatchObject({
      kind: 'letter',
      subjectId: letter.id,
      pinnedBy: { id: ali.memberId },
      summary: { subject: 'پیگیری قرارداد پیمانکار', read: false, attachmentCount: 1 },
      can: { unpin: true },
    });
    const evidenceId = (res.body as Evidence).id;
    expect(
      (await ali.c.get(`/api/tasks/${task.id}/evidence/candidates`)).body.map(
        (l: { id: string }) => l.id,
      ),
    ).not.toContain(letter.id);
    expect((await lead.c.get(`/api/tasks/${task.id}`)).body.evidenceCount).toBe(1);

    // The manager is not on the letter: the pinned letter yes, the letter itself no.
    const detail: EvidenceDetail = (
      await lead.c.get(`/api/tasks/${task.id}/evidence/${evidenceId}`)
    ).body;
    expect(detail.body.text).toBe('لطفاً قرارداد پیوست را بررسی کنید.');
    expect(detail.attachments.map((a) => a.id)).toEqual([fileId]);
    expect((await lead.c.get(`/api/letters/${letter.id}`)).status).toBe(404);
    expect((await lead.c.download(`/api/attachments/${fileId}/file`)).status).toBe(200);
    expect((await maryam.c.get(`/api/tasks/${task.id}/evidence`)).body).toHaveLength(1);

    // Someone who cannot see the task sees none of it.
    expect((await marketer.c.get(`/api/tasks/${task.id}/evidence`)).status).toBe(404);
    expect((await marketer.c.get(`/api/tasks/${task.id}/evidence/${evidenceId}`)).status).toBe(404);
    expect((await marketer.c.download(`/api/attachments/${fileId}/file`)).status).toBe(404);

    // History and audit.
    const activity = (await lead.c.get(`/api/tasks/${task.id}/activity`)).body as Array<{
      verb: string;
    }>;
    expect(activity.map((a) => a.verb)).toContain('evidence_pinned');
    const audit = (await owner.get('/api/audit-logs')).body as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toContain('task.evidence_pinned');

    // The letter page lists the task for those who see it, not for others.
    const forAli: Letter = (await ali.c.get(`/api/letters/${letter.id}`)).body;
    expect(forAli.pinnedTo).toEqual([{ evidenceId, taskId: task.id, title: 'پیگیری قرارداد' }]);
    expect(forAli.can.pin).toBe(true);
    const forLegal: Letter = (await legal.c.get(`/api/letters/${letter.id}`)).body;
    expect(forLegal.pinnedTo).toEqual([]);
  });

  it('notifies the assignee and the person who assigned, not the pinner', async () => {
    await settle();
    const of = (memberId: string) =>
      withTenant(handle.db, { tenantId }, (tx) =>
        tx
          .select()
          .from(s.notifications)
          .where(
            and(
              eq(s.notifications.recipientId, memberId),
              eq(s.notifications.kind, 'task_evidence_pinned'),
            ),
          ),
      );
    expect((await of(lead.memberId)).map((n) => n.subjectId)).toContain(task.id);
    expect(await of(ali.memberId)).toHaveLength(0);
  });

  it('only someone on the letter who edits the task may pin', async () => {
    const t2 = (await lead.c.post('/api/tasks', { title: 'گزارش هفتگی', assigneeId: ali.memberId }))
      .body as Task;
    // Maryam sees the task but cannot edit it; Legal is on the letter but cannot see the task.
    expect((await pin(maryam, t2.id, letter.id)).status).toBe(403);
    expect((await pin(legal, t2.id, letter.id)).status).toBe(404);
    // The manager edits the task but is not on the letter.
    expect((await pin(lead, t2.id, letter.id)).status).toBe(404);
    expect((await pin(ali, t2.id, letter.id)).status).toBe(201);
    const twice = await pin(ali, t2.id, letter.id);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('already_pinned');
  });

  it('drafts and confidential letters cannot be pinned', async () => {
    const secret = await sendLetter(ali, { to: [legal.memberId], confidential: true });
    const res = await pin(ali, task.id, secret.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('evidence_not_allowed');
    const draft = await ali.c.post('/api/letters', {
      subject: 'پیش‌نویس',
      body: body(''),
      to: [legal.memberId],
    });
    expect((await pin(ali, task.id, draft.body.id)).status).toBe(422);
    expect(
      (await ali.c.get(`/api/tasks/${task.id}/evidence/candidates`)).body.map(
        (l: { id: string }) => l.id,
      ),
    ).not.toContain(secret.id);
    expect((await ali.c.get(`/api/letters/${secret.id}`)).body.can.pin).toBe(false);
  });

  it('unpinning: the pinner or an editor; the letter goes out of sight again', async () => {
    const [evidence] = (await lead.c.get(`/api/tasks/${task.id}/evidence`)).body as Evidence[];
    expect(evidence?.can.unpin).toBe(true); // the manager edits the task
    const asMaryam = (await maryam.c.get(`/api/tasks/${task.id}/evidence`)).body as Evidence[];
    expect(asMaryam[0]?.can.unpin).toBe(false);
    expect((await maryam.c.delete(`/api/tasks/${task.id}/evidence/${evidence?.id}`)).status).toBe(
      403,
    );
    expect((await ali.c.delete(`/api/tasks/${task.id}/evidence/${evidence?.id}`)).status).toBe(204);
    expect((await lead.c.get(`/api/tasks/${task.id}/evidence`)).body).toEqual([]);
    expect((await lead.c.get(`/api/tasks/${task.id}`)).body.evidenceCount).toBe(0);
    expect((await lead.c.get(`/api/tasks/${task.id}/evidence/${evidence?.id}`)).status).toBe(404);
    // Still pinned to the other task, which the manager also sees: so download still works there.
    const t2 = (await ali.c.get(`/api/letters/${letter.id}`)).body.pinnedTo as Array<{
      taskId: string;
      evidenceId: string;
    }>;
    for (const p of t2) await ali.c.delete(`/api/tasks/${p.taskId}/evidence/${p.evidenceId}`);
    expect((await lead.c.download(`/api/attachments/${fileId}/file`)).status).toBe(404);
    // And it can be pinned again.
    expect((await pin(ali, task.id, letter.id)).status).toBe(201);
    const activity = (await lead.c.get(`/api/tasks/${task.id}/activity`)).body as Array<{
      verb: string;
    }>;
    expect(activity.map((a) => a.verb)).toContain('evidence_unpinned');
  });

  it('says who will see a pinned letter, following the task rules', async () => {
    const personal: EvidenceAudience = (await ali.c.get(`/api/tasks/${task.id}/evidence/audience`))
      .body;
    expect(personal.people).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ali.memberId, role: 'assignee' }),
        expect.objectContaining({ id: lead.memberId, role: 'reporter' }),
      ]),
    );
    expect(personal.groups.map((g) => g.kind)).toEqual(['department', 'company_readers']);
    expect(personal.groups[0]?.name).toBe('پشتیبانی');

    const makeTask = async (visibility: 'private' | 'tenant') => {
      const project = (
        await lead.c.post('/api/projects', {
          name: `پروژه ${visibility}`,
          visibility,
          departmentId: support.id,
          memberIds: [ali.memberId],
        })
      ).body;
      return (
        await lead.c.post('/api/tasks', {
          title: 'کار پروژه',
          projectId: project.id,
          assigneeId: ali.memberId,
        })
      ).body as Task;
    };
    const privateTask = await makeTask('private');
    const priv: EvidenceAudience = (
      await ali.c.get(`/api/tasks/${privateTask.id}/evidence/audience`)
    ).body;
    expect(priv.groups.map((g) => g.kind)).toEqual(['project_members']);
    const openTask = await makeTask('tenant');
    const open: EvidenceAudience = (await ali.c.get(`/api/tasks/${openTask.id}/evidence/audience`))
      .body;
    expect(open.groups.map((g) => g.kind)).toEqual([
      'project_members',
      'department',
      'company_readers',
      'everyone',
    ]);
  });

  it('lists only the tasks a person may edit when asked', async () => {
    const mine = (await maryam.c.get('/api/tasks?view=department&editable=true')).body as Task[];
    expect(mine.map((t) => t.id)).not.toContain(task.id);
    const forLead = (await lead.c.get('/api/tasks?view=department&editable=true')).body as Task[];
    expect(forLead.map((t) => t.id)).toContain(task.id);
  });

  it('keeps other companies out', async () => {
    expect((await other.get(`/api/tasks/${task.id}/evidence`)).status).toBe(404);
    expect((await other.get(`/api/tasks/${task.id}/evidence/audience`)).status).toBe(404);
    expect((await other.download(`/api/attachments/${fileId}/file`)).status).toBe(404);
    const theirDept = (await other.post('/api/departments', { name: 'فروش' })).body;
    const theirTask = (
      await other.post('/api/tasks', { title: 'کار شرکت دیگر', departmentId: theirDept.id })
    ).body as Task;
    expect(theirTask.id).toBeDefined();
    expect(
      (
        await other.post(`/api/tasks/${theirTask.id}/evidence`, {
          kind: 'letter',
          subjectId: letter.id,
        })
      ).status,
    ).toBe(404);
  });
});
