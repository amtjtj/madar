/**
 * Goals (phase 1, step 7): Jalali-quarter periods, three-level goals with an alignment chain,
 * key results and their append-only check-ins (ADR 0013).
 * Data plane: tenant_id, forced RLS (drizzle/*_goals.sql) and composite (tenant_id, x) FKs.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId, updatedAt } from './columns.js';
import { tenants } from './control.js';
import { departments, members } from './org.js';

export const goalLevel = pgEnum('goal_level', ['company', 'department', 'individual']);
export const keyResultKind = pgEnum('key_result_kind', ['number', 'percent', 'boolean']);
export const checkinStatus = pgEnum('checkin_status', ['on_track', 'at_risk', 'off_track']);

/** One row per Jalali season, created on demand (the name comes from i18n). */
export const goalPeriods = pgTable(
  'goal_periods',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    year: smallint('year').notNull(),
    quarter: smallint('quarter').notNull(),
    startOn: date('start_on', { mode: 'string' }).notNull(),
    endOn: date('end_on', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('goal_periods_tenant_id_id_key').on(t.tenantId, t.id),
    unique('goal_periods_tenant_quarter_key').on(t.tenantId, t.year, t.quarter),
  ],
);

export const goals = pgTable(
  'goals',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').notNull(),
    level: goalLevel('level').notNull(),
    /** Null for company goals, required otherwise. */
    departmentId: uuid('department_id'),
    ownerId: uuid('owner_id').notNull(),
    /** One level up, same period (checked by the API). */
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    description: text('description'),
    /** 0..1, recomputed from key results and child goals on every change (cache). */
    progress: doublePrecision('progress').notNull().default(0),
    status: checkinStatus('status'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('goals_tenant_id_id_key').on(t.tenantId, t.id),
    index('goals_tenant_period_level_idx').on(t.tenantId, t.periodId, t.level),
    index('goals_tenant_parent_idx').on(t.tenantId, t.parentId),
    index('goals_tenant_owner_idx').on(t.tenantId, t.ownerId),
    check('goals_department_by_level', sql`(${t.level} = 'company') = (${t.departmentId} is null)`),
    foreignKey({
      name: 'goals_period_fk',
      columns: [t.tenantId, t.periodId],
      foreignColumns: [goalPeriods.tenantId, goalPeriods.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goals_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goals_owner_fk',
      columns: [t.tenantId, t.ownerId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goals_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goals_parent_fk',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
  ],
);

export const keyResults = pgTable(
  'key_results',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    goalId: uuid('goal_id').notNull(),
    title: text('title').notNull(),
    kind: keyResultKind('kind').notNull(),
    startValue: doublePrecision('start_value').notNull().default(0),
    targetValue: doublePrecision('target_value').notNull(),
    currentValue: doublePrecision('current_value').notNull().default(0),
    unit: text('unit'),
    weight: smallint('weight').notNull().default(1),
    sortKey: text('sort_key').notNull().default('a0'),
    progress: doublePrecision('progress').notNull().default(0),
    status: checkinStatus('status'),
    lastCheckinAt: timestamp('last_checkin_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('key_results_tenant_id_id_key').on(t.tenantId, t.id),
    index('key_results_tenant_goal_idx').on(t.tenantId, t.goalId),
    check('key_results_weight_range', sql`${t.weight} between 1 and 5`),
    foreignKey({
      name: 'key_results_goal_fk',
      columns: [t.tenantId, t.goalId],
      foreignColumns: [goals.tenantId, goals.id],
    }).onDelete('cascade'),
  ],
);

/** Progress updates: append-only history (no UPDATE or DELETE for the app). */
export const keyResultCheckins = pgTable(
  'key_result_checkins',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    keyResultId: uuid('key_result_id').notNull(),
    value: doublePrecision('value').notNull(),
    status: checkinStatus('status').notNull(),
    note: text('note'),
    authorId: uuid('author_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('key_result_checkins_kr_created_idx').on(t.tenantId, t.keyResultId, t.createdAt),
    foreignKey({
      name: 'key_result_checkins_kr_fk',
      columns: [t.tenantId, t.keyResultId],
      foreignColumns: [keyResults.tenantId, keyResults.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'key_result_checkins_author_fk',
      columns: [t.tenantId, t.authorId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);
