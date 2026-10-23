/**
 * Weekly reports (phase 1, step 8b): one snapshot per company, scope and Saturday-based week,
 * built by the worker after the week ends (ADR 0015). `data` follows `weeklyReport` in shared.
 * Data plane: tenant_id, forced RLS (drizzle/*_weekly_reports.sql) and composite (tenant_id, x) FKs.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId } from './columns.js';
import { tenants } from './control.js';
import { departments } from './org.js';

export const reportScope = pgEnum('report_scope', ['company', 'department']);

export const weeklyReports = pgTable(
  'weekly_reports',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    scope: reportScope('scope').notNull(),
    /** Null for the company report. */
    departmentId: uuid('department_id'),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('weekly_reports_tenant_id_id_key').on(t.tenantId, t.id),
    // One per scope and week; NULLS NOT DISTINCT makes the company report unique too.
    unique('weekly_reports_week_key')
      .on(t.tenantId, t.scope, t.departmentId, t.weekStart)
      .nullsNotDistinct(),
    check(
      'weekly_reports_department_by_scope',
      sql`(${t.scope} = 'company') = (${t.departmentId} is null)`,
    ),
    foreignKey({
      name: 'weekly_reports_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }).onDelete('cascade'),
  ],
);

/**
 * The assistant's written summary of a weekly report (plan phase-3-step-16a, ADR 0025): made by
 * the worker from the report's own facts, at most once per report, never changed. Readers are the
 * report's readers.
 */
export const reportSummaries = pgTable(
  'report_summaries',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id').notNull(),
    text: text('text').notNull(),
    model: text('model').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('report_summaries_report_key').on(t.tenantId, t.reportId),
    foreignKey({
      name: 'report_summaries_report_fk',
      columns: [t.tenantId, t.reportId],
      foreignColumns: [weeklyReports.tenantId, weeklyReports.id],
    }).onDelete('cascade'),
  ],
);
