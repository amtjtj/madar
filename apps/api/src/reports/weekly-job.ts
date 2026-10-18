import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, schema as s, withTenant, type DbHandle, type Tx } from '@madar/db';
import { addDays, weekStartOf, weeklyReport, workdayStarted, zonedInstant } from '@madar/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { DB_HANDLE } from '../database/tokens.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { Notifier } from '../notifications/notifier.js';
import { buildWeeklyReport, type ReportTarget } from './builder.js';

const BACKFILL_WEEKS = 4;

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

  /**
   * Returns how many reports were stored. Weeks missed while the worker was down, or while a whole
   * week was holidays (Nowruz), are filled in too, up to `BACKFILL_WEEKS`; only the latest week
   * notifies its readers.
   */
  runForTenant(tenantId: string, now = new Date()): Promise<number> {
    return withTenant(this.handle.db, { tenantId }, async (tx) => {
      const loaded = await loadWorkCalendar(tx, tenantId);
      const { date: today, started } = workdayStarted(loaded.calendar, now, loaded.timeZone);
      if (!started) return 0;
      const latest = addDays(weekStartOf(today), -7);
      const [tenant] = await tx
        .select({ name: s.tenants.name, createdAt: s.tenants.createdAt })
        .from(s.tenants)
        .where(eq(s.tenants.id, tenantId));
      if (!tenant) return 0;
      const weekEnd = (weekStart: string) =>
        zonedInstant(addDays(weekStart, 7), '00:00', loaded.timeZone);
      const weeks = Array.from({ length: BACKFILL_WEEKS }, (_, i) => addDays(latest, -7 * i))
        // A company that did not exist during a week has nothing to report for it.
        .filter((weekStart) => tenant.createdAt < weekEnd(weekStart))
        .reverse();
      if (!weeks.length) return 0;
      const existing = await tx
        .select({
          weekStart: s.weeklyReports.weekStart,
          departmentId: s.weeklyReports.departmentId,
        })
        .from(s.weeklyReports)
        .where(inArray(s.weeklyReports.weekStart, weeks));
      const has = (weekStart: string, departmentId: string | null) =>
        existing.some((r) => r.weekStart === weekStart && r.departmentId === departmentId);
      const departments = await tx
        .select({
          id: s.departments.id,
          name: s.departments.name,
          createdAt: s.departments.createdAt,
        })
        .from(s.departments)
        .where(isNull(s.departments.archivedAt));

      let stored = 0;
      for (const weekStart of weeks) {
        const targets: ReportTarget[] = [
          { tenantId, scope: 'company' as const, department: null, weekStart, now },
          ...departments
            // A department created after the week gets its first report the week after.
            .filter((d) => d.createdAt < weekEnd(weekStart))
            .map((d) => ({
              tenantId,
              scope: 'department' as const,
              department: { id: d.id, name: d.name },
              weekStart,
              now,
            })),
        ].filter((target) => !has(weekStart, target.department?.id ?? null));
        for (const target of targets) {
          // Validated before it becomes a permanent (append-only) row.
          const data = weeklyReport.parse(await buildWeeklyReport(tx, target));
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
          if (weekStart !== latest) continue;
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
