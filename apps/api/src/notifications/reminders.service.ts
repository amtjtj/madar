import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, schema as s, withTenant, type DbHandle, type Tx } from '@madar/db';
import { addDays, isWorkingDay, workdayStarted, workingDaysBetween } from '@madar/shared';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';

import { DB_HANDLE } from '../database/tokens.js';
import { loadWorkCalendar } from './calendar.js';
import { Notifier } from './notifier.js';

const OPEN = ['todo', 'in_progress'] as const;

/**
 * Due-date reminders, run every few minutes by the worker. Nothing happens before the tenant's
 * working day starts; each reminder is created once (dedupe key per task, kind and due date).
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger('Reminders');

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly notifier: Notifier,
  ) {}

  async runAll(now = new Date()): Promise<void> {
    for (const tenant of await listActiveTenants(this.handle.db)) {
      try {
        await this.runForTenant(tenant.id, now);
      } catch (error) {
        this.logger.error(`tenant ${tenant.id}: ${String(error)}`);
      }
    }
  }

  runForTenant(tenantId: string, now = new Date()): Promise<number> {
    return withTenant(this.handle.db, { tenantId }, async (tx) => {
      const loaded = await loadWorkCalendar(tx, tenantId);
      const { calendar, timeZone } = loaded;
      const { date: today, started } = workdayStarted(calendar, now, timeZone);
      if (!started) return 0;

      // «Due soon»: due between tomorrow and the next working day (covers weekends and holidays).
      let nextWorkday = addDays(today, 1);
      for (let i = 0; i < 14 && !isWorkingDay(calendar, nextWorkday); i++) {
        nextWorkday = addDays(nextWorkday, 1);
      }
      let created = 0;
      const base = { tenantId, actorId: null, now, calendar: loaded };
      for (const task of await this.openTasks(
        tx,
        gte(s.tasks.dueOn, addDays(today, 1)),
        lte(s.tasks.dueOn, nextWorkday),
      )) {
        if (!task.assigneeId || !task.dueOn) continue;
        if (
          await this.notifier.notify(tx, {
            ...base,
            recipientId: task.assigneeId,
            kind: 'task_due_soon',
            subjectType: 'task',
            subjectId: task.id,
            payload: { title: task.title, data: { dueOn: task.dueOn } },
            dedupeKey: `due_soon:${task.id}:${task.dueOn}`,
          })
        )
          created++;
      }

      // «Overdue» once per due date for the assignee.
      for (const task of await this.openTasks(
        tx,
        lt(s.tasks.dueOn, today),
        notReminded('task_overdue', 'overdue'),
      )) {
        if (!task.dueOn || !task.assigneeId) continue;
        if (
          await this.notifier.notify(tx, {
            ...base,
            recipientId: task.assigneeId,
            kind: 'task_overdue',
            subjectType: 'task',
            subjectId: task.id,
            payload: { title: task.title, data: { dueOn: task.dueOn } },
            dedupeKey: `overdue:${task.id}:${task.dueOn}`,
          })
        )
          created++;
      }

      // After N working days, the department's head and managers, once per task and due date.
      if (calendar.overdueEscalationDays > 0) {
        // The latest due date that is N working days behind today.
        let cutoff = today;
        for (
          let i = 0;
          i < 400 && workingDaysBetween(calendar, cutoff, today) < calendar.overdueEscalationDays;
          i++
        ) {
          cutoff = addDays(cutoff, -1);
        }
        const managersByDept = new Map<string, string[]>();
        const late = await this.openTasks(
          tx,
          lte(s.tasks.dueOn, cutoff),
          notReminded('task_overdue_escalation', 'escalation'),
        );
        for (const task of late) {
          if (!task.dueOn) continue;
          let managers = managersByDept.get(task.departmentId);
          if (!managers) {
            managers = await this.managers(tx, task.departmentId);
            managersByDept.set(task.departmentId, managers);
          }
          const days = workingDaysBetween(calendar, task.dueOn, today);
          for (const managerId of managers) {
            if (managerId === task.assigneeId) continue;
            if (
              await this.notifier.notify(tx, {
                ...base,
                recipientId: managerId,
                kind: 'task_overdue_escalation',
                subjectType: 'task',
                subjectId: task.id,
                payload: {
                  title: task.title,
                  data: { dueOn: task.dueOn, days, assignee: task.assigneeName ?? '' },
                },
                dedupeKey: `escalation:${task.id}:${task.dueOn}`,
              })
            )
              created++;
          }
        }
      }
      return created;
    });
  }

  /** Open tasks with a due date, oldest due first (so a capped batch never starves old tasks). */
  private openTasks(tx: Tx, ...conditions: SQL[]) {
    return tx
      .select({
        id: s.tasks.id,
        title: s.tasks.title,
        dueOn: s.tasks.dueOn,
        assigneeId: s.tasks.assigneeId,
        assigneeName: s.members.displayName,
        departmentId: s.tasks.departmentId,
      })
      .from(s.tasks)
      .leftJoin(s.members, eq(s.members.id, s.tasks.assigneeId))
      .where(
        and(
          isNull(s.tasks.deletedAt),
          isNotNull(s.tasks.dueOn),
          inArray(s.tasks.statusCategory, [...OPEN]),
          ...conditions,
        ),
      )
      .orderBy(asc(s.tasks.dueOn), asc(s.tasks.id))
      .limit(2000);
  }

  private async managers(tx: Tx, departmentId: string): Promise<string[]> {
    const rows = await tx
      .select({ memberId: s.departmentMemberships.memberId })
      .from(s.departmentMemberships)
      .innerJoin(s.members, eq(s.members.id, s.departmentMemberships.memberId))
      .where(
        and(
          eq(s.departmentMemberships.departmentId, departmentId),
          inArray(s.departmentMemberships.deptRole, ['head', 'manager']),
          eq(s.members.status, 'active'),
        ),
      );
    return rows.map((r) => r.memberId);
  }
}

/**
 * Tasks not yet reminded of this kind for their current due date (same dedupe key as notify()), so
 * the sweep skips them in SQL instead of re-checking every task every 15 minutes.
 */
function notReminded(kind: string, prefix: string): SQL {
  return sql`not exists (
    select 1 from notifications n
    where n.subject_id = ${s.tasks.id} and n.kind = ${kind}
      and n.dedupe_key = ${prefix} || ':' || ${s.tasks.id}::text || ':' || ${s.tasks.dueOn}::text)`;
}
