import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, schema as s, withTenant, type DbHandle, type Tx } from '@madar/db';
import { addDays, weekStartOf, workdayStarted, zonedInstant } from '@madar/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { DB_HANDLE } from '../database/tokens.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { Notifier } from '../notifications/notifier.js';
import { buildWeeklyReport, type ReportTarget } from './builder.js';

/**
 * Weekly report snapshots (worker, every 15 minutes with the reminders). Once the first working
 * day of a week has started, last week's company and department reports are stored (once) and
 * their readers get a «report ready» notification (ADR 0015).
 */
@Injectable()
export class WeeklyReportsJob {
  private readonly logger = new Logger('WeeklyReports');

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

  /** Returns how many reports were stored. */
  runForTenant(tenantId: string, now = new Date()): Promise<number> {
    return withTenant(this.handle.db, { tenantId }, async (tx) => {
      const loaded = await loadWorkCalendar(tx, tenantId);
      const { date: today, started } = workdayStarted(loaded.calendar, now, loaded.timeZone);
      if (!started) return 0;
      const weekStart = addDays(weekStartOf(today), -7);
      const [tenant] = await tx
        .select({ name: s.tenants.name, createdAt: s.tenants.createdAt })
        .from(s.tenants)
        .where(eq(s.tenants.id, tenantId));
      // A company that did not exist during that week has nothing to report.
      if (
        !tenant ||
        tenant.createdAt >= zonedInstant(addDays(weekStart, 7), '00:00', loaded.timeZone)
      ) {
        return 0;
      }
      const departments = await tx
        .select({ id: s.departments.id, name: s.departments.name })
        .from(s.departments)
        .where(isNull(s.departments.archivedAt));
      const targets: ReportTarget[] = [
        { tenantId, scope: 'company', department: null, weekStart, now },
        ...departments.map((d) => ({
          tenantId,
          scope: 'department' as const,
          department: d,
          weekStart,
          now,
        })),
      ];
      let stored = 0;
      for (const target of targets) {
        const data = await buildWeeklyReport(tx, target);
        const [row] = await tx
          .insert(s.weeklyReports)
          .values({
            scope: target.scope,
            departmentId: target.department?.id ?? null,
            weekStart,
            data: data as unknown as Record<string, unknown>,
          })
          .onConflictDoNothing()
          .returning({ id: s.weeklyReports.id });
        if (!row) continue;
        stored++;
        for (const recipientId of await this.recipients(tx, target)) {
          await this.notifier.notify(tx, {
            tenantId,
            recipientId,
            actorId: null,
            kind: 'weekly_report_ready',
            subjectType: 'report',
            subjectId: row.id,
            payload: {
              title: target.department?.name ?? tenant.name,
              data: {
                week: weekStart,
                scope: target.scope,
                ...(target.department ? { departmentId: target.department.id } : {}),
              },
            },
            dedupeKey: `weekly_report:${row.id}`,
            now,
            calendar: loaded,
          });
        }
      }
      return stored;
    });
  }

  /** Company: owner and executive roles. Department: its head and managers (plan, answer 2). */
  private async recipients(tx: Tx, target: ReportTarget): Promise<string[]> {
    if (target.department) {
      const rows = await tx
        .select({ id: s.departmentMemberships.memberId })
        .from(s.departmentMemberships)
        .innerJoin(s.members, eq(s.members.id, s.departmentMemberships.memberId))
        .where(
          and(
            eq(s.departmentMemberships.departmentId, target.department.id),
            inArray(s.departmentMemberships.deptRole, ['head', 'manager']),
            eq(s.members.status, 'active'),
          ),
        );
      return rows.map((r) => r.id);
    }
    const rows = await tx
      .selectDistinct({ id: s.memberRoles.memberId })
      .from(s.memberRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.memberRoles.roleId))
      .innerJoin(s.members, eq(s.members.id, s.memberRoles.memberId))
      .where(and(inArray(s.roles.key, ['owner', 'executive']), eq(s.members.status, 'active')));
    return rows.map((r) => r.id);
  }
}
