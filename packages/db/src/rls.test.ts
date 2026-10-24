import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from './client.js';
import * as s from './schema/index.js';
import { uuidv7 } from './schema/columns.js';
import {
  appendAudit,
  listActiveTenants,
  listMemberships,
  lockUnpublishedEvents,
  markEventsPublished,
  withTenant,
} from './tenant.js';
import {
  appDb,
  createTenantFixture,
  hasDatabase,
  ownerDb,
  workerDb,
  type TenantFixture,
} from './test/fixtures.js';

/** Tables shared across tenants; everything else must carry tenant_id and forced RLS. */
const CONTROL_PLANE = ['tenants', 'users', 'sessions', 'accounts', 'verifications', 'two_factors'];

const DATA_PLANE = [
  'members',
  'departments',
  'department_memberships',
  'roles',
  'role_grants',
  'member_roles',
  'audit_logs',
  'projects',
  'project_members',
  'tasks',
  'task_collaborators',
  'comments',
  'activities',
  'daily_plan_items',
  'member_task_order',
  'domain_events',
  'work_calendars',
  'notifications',
  'notification_preferences',
  'processed_events',
  'push_subscriptions',
  'attachments',
  'letters',
  'letter_recipients',
  'letter_counters',
  'task_evidence',
  'conversations',
  'conversation_members',
  'messages',
  'message_mentions',
  'message_reactions',
  'meetings',
  'meeting_participants',
  'meeting_minutes',
  'meeting_decisions',
  'meeting_series',
  'meeting_series_participants',
  'goal_periods',
  'goals',
  'key_results',
  'key_result_checkins',
  'weekly_reports',
  'report_summaries',
  'knowledge_chunks',
  'approval_requests',
  'approval_steps',
  'leaves',
] as const;

/** Tables the app may only append to (no UPDATE/DELETE grant). */
const APPEND_ONLY = [
  'audit_logs',
  'activities',
  'processed_events',
  'key_result_checkins',
  'weekly_reports',
  'report_summaries',
  'approval_steps',
  'leaves',
];
/** Tables the app may update but never delete from. */
const NO_DELETE = [
  'domain_events',
  'work_calendars',
  'notifications',
  'notification_preferences',
  'goal_periods',
  'goals',
  'key_results',
  'attachments',
  'letters',
  'letter_counters',
  'task_evidence',
  'conversations',
  'conversation_members',
  'messages',
  'meetings',
  'meeting_minutes',
  'meeting_series',
  'approval_requests',
];

describe.skipIf(!hasDatabase)('tenant isolation (RLS)', () => {
  let app: DbHandle;
  let a: TenantFixture;
  let b: TenantFixture;

  beforeAll(async () => {
    app = appDb();
    a = await createTenantFixture(app, 'a');
    b = await createTenantFixture(app, 'b');
    for (const t of [a, b]) {
      await withTenant(app.db, { tenantId: t.tenantId, userId: t.userId }, (tx) =>
        appendAudit(tx, {
          action: 'fixture.created',
          subjectType: 'tenant',
          subjectId: t.tenantId,
        }),
      );
    }
  });

  afterAll(() => app?.close());

  it('connects as a role that cannot bypass RLS', async () => {
    const { rows } = await app.pool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      owner: boolean;
    }>(`
      select r.rolsuper, r.rolbypassrls,
             exists (select 1 from pg_tables where tableowner = current_user and schemaname = 'public') as owner
      from pg_roles r where r.rolname = current_user`);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owner: false });
  });

  it('every non-control-plane table has tenant_id and forced RLS with a policy (meta test)', async () => {
    const { rows } = await app.pool.query<{
      table: string;
      has_tenant: boolean;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(`
      select c.relname as table,
             exists (select 1 from information_schema.columns col
                     where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id') as has_tenant,
             c.relrowsecurity as rls,
             c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'tenant_isolation') as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by 1`);
    const problems = rows
      .filter((r) => !CONTROL_PLANE.includes(r.table))
      .filter((r) => !r.has_tenant || !r.rls || !r.forced || r.policies !== 1)
      .map((r) => r.table);
    expect(problems).toEqual([]);
    expect(rows.map((r) => r.table)).toEqual(expect.arrayContaining([...DATA_PLANE]));
  });

  it.each(DATA_PLANE)('%s: tenant A sees only its own rows', async (table) => {
    const counts = await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
      const own = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where tenant_id = ${a.tenantId}`,
      );
      const other = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where tenant_id <> ${a.tenantId}`,
      );
      return { own: own.rows[0]?.n, other: other.rows[0]?.n };
    });
    expect(counts.own).toBeGreaterThan(0);
    expect(counts.other).toBe(0);
  });

  it.each(DATA_PLANE.filter((t) => !APPEND_ONLY.includes(t)))(
    "%s: tenant A cannot update, delete or insert tenant B's rows",
    async (table) => {
      await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
        const updated = await tx.execute(
          sql`update ${sql.identifier(table)} set tenant_id = tenant_id where tenant_id = ${b.tenantId}`,
        );
        expect(updated.rowCount).toBe(0);
        if (!NO_DELETE.includes(table)) {
          const deleted = await tx.execute(
            sql`delete from ${sql.identifier(table)} where tenant_id = ${b.tenantId}`,
          );
          expect(deleted.rowCount).toBe(0);
        }
      });
      // Writing a row that claims tenant B fails the WITH CHECK clause.
      await expect(
        withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
          tx.insert(s.roles).values({ tenantId: b.tenantId, key: `x-${table}`, name: 'x' }),
        ),
      ).rejects.toThrow();
    },
  );

  it('without a tenant context nothing is visible and nothing can be written', async () => {
    const { rows } = await app.pool.query<{ n: number }>('select count(*)::int as n from members');
    expect(rows[0]?.n).toBe(0);
    await expect(
      app.db.insert(s.roles).values({ key: 'orphan', name: 'orphan' }),
    ).rejects.toThrow();
  });

  it("composite foreign keys reject references to another tenant's rows", async () => {
    await expect(
      withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
        tx
          .update(s.members)
          .set({ managerId: b.memberId })
          .where(sql`${s.members.id} = ${a.memberId}`),
      ),
    ).rejects.toThrow();
  });

  it("a letter cannot be addressed to another tenant's member", async () => {
    const [letter] = await withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.select({ id: s.letters.id }).from(s.letters).limit(1),
    );
    expect(letter).toBeDefined();
    await expect(
      withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
        tx
          .insert(s.letterRecipients)
          .values({ letterId: letter?.id ?? '', memberId: b.memberId, kind: 'cc' }),
      ),
    ).rejects.toThrow();
  });

  it("a sent letter's recipients cannot be deleted, a draft's can", async () => {
    await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
      const sent = await tx.execute(sql`delete from letter_recipients`);
      expect(sent.rowCount).toBe(0);
      const draftId = uuidv7();
      await tx.insert(s.letters).values({
        id: draftId,
        subject: 'پیش‌نویس',
        body: { format: 'lite', text: '' },
        senderId: a.memberId,
        threadId: draftId,
      });
      await tx
        .insert(s.letterRecipients)
        .values({ letterId: draftId, memberId: a.memberId, kind: 'to' });
      const draft = await tx.execute(
        sql`delete from letter_recipients where letter_id = ${draftId}`,
      );
      expect(draft.rowCount).toBe(1);
    });
  });

  it('a sent letter cannot be changed, even by the app role directly', async () => {
    await expect(
      withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
        tx.execute(sql`update letters set subject = 'دست‌کاری' where sent_at is not null`),
      ),
    ).rejects.toThrow();
    // Per-person state still changes.
    await withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.execute(sql`update letters set sender_archived_at = now() where sent_at is not null`),
    );
  });

  it("evidence cannot point at another tenant's task; a pin can be made again after unpinning", async () => {
    const [mine] = await withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.select().from(s.taskEvidence).limit(1),
    );
    const [theirs] = await withTenant(app.db, { tenantId: b.tenantId }, (tx) =>
      tx.select({ taskId: s.taskEvidence.taskId }).from(s.taskEvidence).limit(1),
    );
    expect(mine && theirs).toBeTruthy();
    await expect(
      withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
        tx.insert(s.taskEvidence).values({
          taskId: theirs?.taskId ?? '',
          kind: 'letter',
          subjectId: mine?.subjectId ?? '',
          pinnedBy: a.memberId,
        }),
      ),
    ).rejects.toThrow();
    await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
      const again = {
        taskId: mine?.taskId ?? '',
        kind: 'letter' as const,
        subjectId: mine?.subjectId ?? '',
        pinnedBy: a.memberId,
      };
      await expect(
        tx.transaction((inner) => inner.insert(s.taskEvidence).values(again)),
      ).rejects.toThrow();
      await tx
        .update(s.taskEvidence)
        .set({ unpinnedAt: new Date(), unpinnedBy: a.memberId })
        .where(sql`${s.taskEvidence.id} = ${mine?.id ?? ''}`);
      await tx.insert(s.taskEvidence).values(again);
    });
  });

  it("a message cannot be written into another tenant's conversation", async () => {
    const [theirs] = await withTenant(app.db, { tenantId: b.tenantId }, (tx) =>
      tx.select({ id: s.conversations.id }).from(s.conversations).limit(1),
    );
    expect(theirs).toBeDefined();
    await expect(
      withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
        tx
          .insert(s.messages)
          .values({ conversationId: theirs?.id ?? '', authorId: a.memberId, body: 'x' }),
      ),
    ).rejects.toThrow();
  });

  it('a reply cannot point into another conversation', async () => {
    await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
      const [one, two] = await tx
        .insert(s.conversations)
        .values([
          { kind: 'group', title: 'one', createdBy: a.memberId },
          { kind: 'group', title: 'two', createdBy: a.memberId },
        ])
        .returning({ id: s.conversations.id });
      const [original] = await tx
        .insert(s.messages)
        .values({ conversationId: one?.id ?? '', authorId: a.memberId, body: 'secret' })
        .returning({ id: s.messages.id });
      await expect(
        tx.transaction((inner) =>
          inner.insert(s.messages).values({
            conversationId: two?.id ?? '',
            authorId: a.memberId,
            body: 'quote',
            replyToId: original?.id ?? null,
          }),
        ),
      ).rejects.toThrow();
      await tx.insert(s.messages).values({
        conversationId: one?.id ?? '',
        authorId: a.memberId,
        body: 'fine',
        replyToId: original?.id ?? null,
      });
    });
  });

  it('reactions take only the fixed emoji set and never point into another company', async () => {
    const [theirs] = await withTenant(app.db, { tenantId: b.tenantId }, (tx) =>
      tx.select({ id: s.messages.id }).from(s.messages).limit(1),
    );
    await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
      const [mine] = await tx.select({ id: s.messages.id }).from(s.messages).limit(1);
      await expect(
        tx.transaction((inner) =>
          inner
            .insert(s.messageReactions)
            .values({ messageId: mine?.id ?? '', memberId: a.memberId, emoji: '💩' }),
        ),
      ).rejects.toThrow();
      await expect(
        tx.transaction((inner) =>
          inner
            .insert(s.messageReactions)
            .values({ messageId: theirs?.id ?? '', memberId: a.memberId, emoji: '👍' }),
        ),
      ).rejects.toThrow();
      await expect(
        tx.transaction((inner) =>
          inner
            .insert(s.messageMentions)
            .values({ messageId: theirs?.id ?? '', memberId: a.memberId }),
        ),
      ).rejects.toThrow();
    });
  });

  it("meetings never take another company's people, tasks or key results", async () => {
    const [theirs] = await withTenant(app.db, { tenantId: b.tenantId }, (tx) =>
      tx.select({ id: s.meetings.id }).from(s.meetings).limit(1),
    );
    const [theirTask] = await withTenant(app.db, { tenantId: b.tenantId }, (tx) =>
      tx.select({ id: s.tasks.id }).from(s.tasks).limit(1),
    );
    await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
      const [mine] = await tx.select({ id: s.meetings.id }).from(s.meetings).limit(1);
      const meetingId = mine?.id ?? '';
      const attempts = [
        () => tx.insert(s.meetingParticipants).values({ meetingId, memberId: b.memberId }),
        () =>
          tx
            .insert(s.meetingParticipants)
            .values({ meetingId: theirs?.id ?? '', memberId: a.memberId }),
        () =>
          tx.insert(s.meetingDecisions).values({
            meetingId,
            text: 'x',
            taskId: theirTask?.id ?? '',
            createdBy: a.memberId,
          }),
        () =>
          tx
            .update(s.meetings)
            .set({ organizerId: b.memberId })
            .where(sql`${s.meetings.id} = ${meetingId}`),
      ];
      for (const attempt of attempts) {
        await expect(tx.transaction(async () => attempt())).rejects.toThrow();
      }
    });
  });

  it('a meeting ends after it starts; a decision with a task cannot be deleted', async () => {
    await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
      await expect(
        tx.transaction((inner) => inner.execute(sql`update meetings set ends_at = starts_at`)),
      ).rejects.toThrow();
      const withTask = await tx.execute(
        sql`delete from meeting_decisions where task_id is not null`,
      );
      expect(withTask.rowCount).toBe(0);
      const without = await tx.execute(sql`delete from meeting_decisions where task_id is null`);
      expect(without.rowCount).toBe(1);
    });
  });

  it("a weekly series never takes another company's people and meets once a day at most", async () => {
    await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
      const [series] = await tx.select().from(s.meetingSeries).limit(1);
      const seriesId = series?.id ?? '';
      await expect(
        tx.transaction((inner) =>
          inner.insert(s.meetingSeriesParticipants).values({ seriesId, memberId: b.memberId }),
        ),
      ).rejects.toThrow();
      // The same series twice on one day.
      await expect(
        tx.transaction((inner) =>
          inner.insert(s.meetings).values({
            type: 'regular',
            title: 'x',
            startsAt: new Date('2026-10-24T05:30:00Z'),
            endsAt: new Date('2026-10-24T06:00:00Z'),
            organizerId: a.memberId,
            departmentId: series?.departmentId ?? '',
            seriesId,
            occursOn: '2026-10-24',
          }),
        ),
      ).rejects.toThrow();
      await expect(
        tx.transaction((inner) =>
          inner.execute(sql`update meeting_series set end_time = start_time`),
        ),
      ).rejects.toThrow();
    });
    const [theirs] = await withTenant(app.db, { tenantId: b.tenantId }, (tx) =>
      tx.select({ id: s.meetingSeries.id }).from(s.meetingSeries).limit(1),
    );
    await expect(
      withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
        tx.execute(
          sql`update meetings set series_id = ${theirs?.id ?? ''} where series_id is not null`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("requests never take another company's people; decided requests and decisions stay as they were", async () => {
    await withTenant(app.db, { tenantId: a.tenantId }, async (tx) => {
      const [open] = await tx
        .select()
        .from(s.approvalRequests)
        .where(sql`status = 'pending'`)
        .limit(1);
      await expect(
        tx.transaction((inner) =>
          inner.insert(s.approvalSteps).values({
            requestId: open?.id ?? '',
            stepIndex: 0,
            approverId: b.memberId,
            decidedBy: b.memberId,
            decision: 'approved',
          }),
        ),
      ).rejects.toThrow();
      // An expense carries an amount; nothing else does.
      await expect(
        tx.transaction((inner) =>
          inner.execute(
            sql`update approval_requests set amount_rial = null where kind = 'expense'`,
          ),
        ),
      ).rejects.toThrow();
      // A decided request is not changed, not even by the app role directly.
      const decided = await tx.execute(
        sql`update approval_requests set title = 'x' where status <> 'pending'`,
      );
      expect(decided.rowCount).toBe(0);
      const pending = await tx.execute(
        sql`update approval_requests set status = 'canceled', decided_at = now() where status = 'pending'`,
      );
      expect(pending.rowCount).toBe(1);
      // A leave for another company's member.
      const [leave] = await tx.select().from(s.leaves).limit(1);
      if (!leave) throw new Error('fixture leave missing');
      await expect(
        tx.transaction((inner) =>
          inner.insert(s.leaves).values({ ...leave, id: uuidv7(), memberId: b.memberId }),
        ),
      ).rejects.toThrow();
    });
  });

  it('transaction-local settings do not leak to the next query on the same connection', async () => {
    const single = appDb();
    try {
      await withTenant(single.db, { tenantId: a.tenantId }, async () => undefined);
      const { rows } = await single.pool.query<{ t: string | null }>(
        "select nullif(current_setting('app.tenant_id', true), '') as t",
      );
      expect(rows[0]?.t).toBeNull();
    } finally {
      await single.close();
    }
  });

  it('lists all memberships of a user across tenants only through the platform function', async () => {
    await withTenant(app.db, { tenantId: b.tenantId }, (tx) =>
      tx.insert(s.members).values({ userId: a.userId, displayName: 'guest in b' }),
    );
    const memberships = await listMemberships(app.db, a.userId);
    expect(memberships.map((m) => m.tenantId).sort()).toEqual([a.tenantId, b.tenantId].sort());
  });
});

describe.skipIf(!hasDatabase)('activity history', () => {
  let app: DbHandle;
  let t: TenantFixture;

  beforeAll(async () => {
    app = appDb();
    t = await createTenantFixture(app, 'act');
  });
  afterAll(() => app?.close());

  it('the app role cannot delete domain events', async () => {
    const error = await withTenant(app.db, { tenantId: t.tenantId }, (tx) =>
      tx.execute(sql`delete from domain_events`),
    ).then(
      () => null,
      (e: unknown) => e as Error & { cause?: Error },
    );
    expect(error?.cause?.message ?? error?.message).toMatch(/permission denied/);
  });

  it('is append-only for the app role', async () => {
    for (const statement of [
      sql`update activities set verb = 'tampered'`,
      sql`delete from activities`,
    ]) {
      const error = await withTenant(app.db, { tenantId: t.tenantId }, (tx) =>
        tx.execute(statement),
      ).then(
        () => null,
        (e: unknown) => e as Error & { cause?: Error },
      );
      expect(error?.cause?.message ?? error?.message).toMatch(/permission denied/);
    }
  });
});

describe.skipIf(!hasDatabase)('audit log', () => {
  let app: DbHandle;
  let owner: DbHandle;
  let t: TenantFixture;

  beforeAll(async () => {
    app = appDb();
    owner = ownerDb();
    t = await createTenantFixture(app, 'audit');
  });

  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });

  it('appends a hash chain with sequential numbers and records the actor', async () => {
    await withTenant(
      app.db,
      { tenantId: t.tenantId, memberId: t.memberId, userId: t.userId },
      async (tx) => {
        await appendAudit(tx, {
          action: 'member.role_changed',
          subjectType: 'member',
          subjectId: t.memberId,
          before: { roles: [] },
          after: { roles: ['admin'] },
        });
        await appendAudit(tx, {
          action: 'department.oversight_changed',
          subjectType: 'department',
          subjectId: t.departmentId,
        });
      },
    );
    const rows = await withTenant(app.db, { tenantId: t.tenantId }, (tx) =>
      tx.select().from(s.auditLogs).orderBy(s.auditLogs.seq),
    );
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[0]?.prevHash).toBeNull();
    expect(rows[1]?.prevHash).toBe(rows[0]?.hash);
    expect(rows[0]?.actorMemberId).toBe(t.memberId);
    expect(rows[0]?.after).toEqual({ roles: ['admin'] });
    const broken = await withTenant(app.db, { tenantId: t.tenantId }, (tx) =>
      tx.execute(sql`select * from app.verify_audit_chain()`),
    );
    expect(broken.rows).toEqual([]);
  });

  it('the app role cannot insert, update or delete audit rows directly', async () => {
    for (const statement of [
      sql`insert into audit_logs (tenant_id, seq, action, subject_type, hash) values (${t.tenantId}, 99, 'x', 'x', 'x')`,
      sql`update audit_logs set action = 'tampered'`,
      sql`delete from audit_logs`,
    ]) {
      const error = await withTenant(app.db, { tenantId: t.tenantId }, (tx) =>
        tx.execute(statement),
      ).then(
        () => null,
        (e: unknown) => e as Error & { cause?: Error },
      );
      // Drizzle wraps the Postgres error; the reason is on `cause`.
      expect(error?.cause?.message ?? error?.message).toMatch(/permission denied/);
    }
  });

  it('detects tampering done outside the application', async () => {
    await owner.pool.query(
      'update audit_logs set after = \'{"roles":["owner"]}\'::jsonb where tenant_id = $1 and seq = 1',
      [t.tenantId],
    );
    const broken = await withTenant(app.db, { tenantId: t.tenantId }, (tx) =>
      tx.execute<{ seq: number; problem: string }>(sql`select * from app.verify_audit_chain()`),
    );
    expect(broken.rows[0]).toMatchObject({ problem: 'hash does not match row contents' });
  });
});

describe.skipIf(!hasDatabase)('outbox relay functions', () => {
  let app: DbHandle;
  let worker: DbHandle;
  let a: TenantFixture;
  let b: TenantFixture;

  // Relays here only look at this suite's tenants. Our events are dated in the past so they come
  // before the fixture's own task.created event (oldest first).
  let stamp = Date.UTC(1990, 0, 1);
  const oldEvent = (tenantId: string, type: string) =>
    withTenant(app.db, { tenantId }, async (tx) => {
      const [row] = await tx
        .insert(s.domainEvents)
        .values({ type, payload: { test: true }, occurredAt: new Date(stamp++) })
        .returning({ id: s.domainEvents.id });
      return row?.id ?? '';
    });

  beforeAll(async () => {
    app = appDb();
    worker = workerDb();
    a = await createTenantFixture(app, 'ra');
    b = await createTenantFixture(app, 'rb');
  });
  afterAll(async () => {
    await app?.close();
    await worker?.close();
  });

  it('only the worker role may call the cross-tenant functions', async () => {
    const denied = (e: unknown) => String((e as { cause?: Error }).cause?.message ?? e);
    await expect(
      app.db.transaction((tx) => lockUnpublishedEvents(tx, 1)).catch(denied),
    ).resolves.toMatch(/permission denied/);
    await expect(listActiveTenants(app.db).catch(denied)).resolves.toMatch(/permission denied/);
    await expect(
      app.db.transaction((tx) => markEventsPublished(tx, [a.tenantId])).catch(denied),
    ).resolves.toMatch(/permission denied/);
  });

  it("the app role cannot read other tenants' events directly", async () => {
    const other = await withTenant(app.db, { tenantId: a.tenantId }, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from domain_events where tenant_id = ${b.tenantId}`,
      ),
    );
    expect(other.rows[0]?.n).toBe(0);
  });

  it('hands each event of every tenant to one relay only, then never again', async () => {
    const ids = [
      await oldEvent(a.tenantId, 'task.created'),
      await oldEvent(b.tenantId, 'task.created'),
    ];
    const first = worker.db.transaction(async (tx) => {
      const events = await lockUnpublishedEvents(tx, 1, [a.tenantId, b.tenantId]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await markEventsPublished(
        tx,
        events.map((e) => e.id),
      );
      return events;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await worker.db.transaction(async (tx) => {
      const events = await lockUnpublishedEvents(tx, 1, [a.tenantId, b.tenantId]);
      await markEventsPublished(
        tx,
        events.map((e) => e.id),
      );
      return events;
    });
    const firstEvents = await first;
    expect(firstEvents.map((e) => e.id)).toEqual([ids[0]]);
    expect(second.map((e) => e.id)).toEqual([ids[1]]);
    expect(firstEvents[0]).toMatchObject({
      tenantId: a.tenantId,
      type: 'task.created',
      version: 1,
    });
    expect(second[0]?.tenantId).toBe(b.tenantId);

    const again = await worker.db.transaction((tx) =>
      lockUnpublishedEvents(tx, 5, [a.tenantId, b.tenantId]),
    );
    expect(again.map((e) => e.id)).not.toContain(ids[0]);
    expect(again.map((e) => e.id)).not.toContain(ids[1]);
  });

  it('a relay that fails before commit leaves the events for the next one', async () => {
    const id = await oldEvent(a.tenantId, 'comment.created');
    await expect(
      worker.db.transaction(async (tx) => {
        expect(
          (await lockUnpublishedEvents(tx, 1, [a.tenantId, b.tenantId])).map((e) => e.id),
        ).toEqual([id]);
        throw new Error('crash before enqueue');
      }),
    ).rejects.toThrow('crash before enqueue');
    const retry = await worker.db.transaction(async (tx) => {
      const events = await lockUnpublishedEvents(tx, 1, [a.tenantId, b.tenantId]);
      await markEventsPublished(
        tx,
        events.map((e) => e.id),
      );
      return events;
    });
    expect(retry.map((e) => e.id)).toEqual([id]);
  });

  it('lists active tenants with their time zone only', async () => {
    const tenants = await listActiveTenants(worker.db);
    expect(tenants.find((t) => t.id === a.tenantId)).toEqual({
      id: a.tenantId,
      timezone: 'Asia/Tehran',
    });
  });
});
