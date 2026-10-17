import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, schema as s, withTenant, type DbHandle, type Tx } from '@madar/db';
import { addDays, isWorkingDay, workdayStarted, workingDaysBetween } from '@madar/shared';
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm';

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
      const { calendar, timeZone } = await loadWorkCalendar(tx, tenantId);
      const { date: today, started } = workdayStarted(calendar, now, timeZone);
      if (!started) return 0;

      // «Due soon»: due between tomorrow and the next working day (covers weekends and holidays).
      let nextWorkday = addDays(today, 1);
      for (let i = 0; i < 14 && !isWorkingDay(calendar, nextWorkday); i++) {
        nextWorkday = addDays(nextWorkday, 1);
      }
      let created = 0;
      const base = { tenantId, actorId: null, now };
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

      // «Overdue» once per due date for the assignee, and after N working days for the managers.
      const overdue = await this.openTasks(tx, lt(s.tasks.dueOn, today));
      const managersByDept = new Map<string, string[]>();
      for (const task of overdue) {
        if (!task.dueOn) continue;
        if (task.assigneeId) {
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
        const days = workingDaysBetween(calendar, task.dueOn, today);
        if (calendar.overdueEscalationDays > 0 && days >= calendar.overdueEscalationDays) {
          let managers = managersByDept.get(task.departmentId);
          if (!managers) {
            managers = await this.managers(tx, task.departmentId);
            managersByDept.set(task.departmentId, managers);
          }
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

  private openTasks(tx: Tx, ...conditions: ReturnType<typeof eq>[]) {
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
