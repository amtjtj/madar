import { HttpStatus, Injectable } from '@nestjs/common';
import { schema as s, type Tx } from '@madar/db';
import {
  calendarDateIn,
  weekStartOf,
  type ReportRef,
  type ReportWeeksQuery,
  type WeeklyReport,
  type WeeklyReportQuery,
} from '@madar/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { readsReport } from '../work/access.js';
import { buildWeeklyReport } from './builder.js';

/** Weekly reports: the company one for company-wide readers, a department's for its managers too. */
@Injectable()
export class ReportsService {
  constructor(private readonly db: TenantDb) {}

  weekly(ctx: TenantContext, query: WeeklyReportQuery): Promise<WeeklyReport> {
    this.authorize(ctx, query);
    return this.db.run(ctx, async (tx) => {
      const department = await this.department(tx, query);
      const { timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
      const current = weekStartOf(calendarDateIn(new Date(), timeZone));
      const week = query.week ? weekStartOf(query.week) : current;
      if (week > current) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'Future week');
      }
      // The running week is built live; finished weeks come from their snapshot.
      if (week === current) {
        return buildWeeklyReport(tx, {
          tenantId: ctx.tenantId,
          scope: query.scope,
          department,
          weekStart: week,
        });
      }
      const [row] = await tx
        .select({ data: s.weeklyReports.data })
        .from(s.weeklyReports)
        .where(this.where(query, week));
      if (!row) throw notFound('Report');
      return row.data as unknown as WeeklyReport;
    });
  }

  /** Weeks with a report, newest first; the running week first of all. */
  weeks(ctx: TenantContext, query: ReportWeeksQuery): Promise<string[]> {
    this.authorize(ctx, query);
    return this.db.run(ctx, async (tx) => {
      await this.department(tx, query);
      const { timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
      const current = weekStartOf(calendarDateIn(new Date(), timeZone));
      const rows = await tx
        .select({ weekStart: s.weeklyReports.weekStart })
        .from(s.weeklyReports)
        .where(this.where(query))
        .orderBy(desc(s.weeklyReports.weekStart))
        .limit(52);
      return [current, ...rows.map((r) => r.weekStart).filter((w) => w !== current)];
    });
  }

  /** The scope and week of a stored report, for links that only carry its id. */
  ref(ctx: TenantContext, id: string): Promise<ReportRef> {
    return this.db.run(ctx, async (tx) => {
      const [row] = await tx
        .select({
          scope: s.weeklyReports.scope,
          departmentId: s.weeklyReports.departmentId,
          week: s.weeklyReports.weekStart,
        })
        .from(s.weeklyReports)
        .where(eq(s.weeklyReports.id, id));
      if (!row) throw notFound('Report');
      if (!readsReport(ctx.actor, row.departmentId)) throw forbidden();
      return row;
    });
  }

  private authorize(ctx: TenantContext, query: ReportWeeksQuery): void {
    const departmentId = query.scope === 'department' ? (query.departmentId ?? null) : null;
    if (readsReport(ctx.actor, departmentId)) return;
    throw forbidden();
  }

  private async department(tx: Tx, query: ReportWeeksQuery) {
    if (query.scope === 'company') return null;
    if (!query.departmentId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'departmentId is required');
    }
    const [row] = await tx
      .select({ id: s.departments.id, name: s.departments.name })
      .from(s.departments)
      .where(eq(s.departments.id, query.departmentId));
    if (!row) throw notFound('Department');
    return row;
  }

  private where(query: ReportWeeksQuery, week?: string) {
    return and(
      eq(s.weeklyReports.scope, query.scope),
      query.scope === 'company' || !query.departmentId
        ? isNull(s.weeklyReports.departmentId)
        : eq(s.weeklyReports.departmentId, query.departmentId),
      week ? eq(s.weeklyReports.weekStart, week) : undefined,
    );
  }
}
