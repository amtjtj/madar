/**
 * Gamification (plan phase-3-step-18a, ADRs 0007 and 0029): an append-only XP ledger, one closed
 * row per member and day for the streak, and a rebuildable stats cache. Only the worker writes
 * here; a member reads their own rows only through `/api/me/*`.
 * Data plane: tenant_id, forced RLS (drizzle/*_gamification.sql) and composite (tenant_id, x) FKs.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  boolean,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId } from './columns.js';
import { tasks } from './work.js';
import { tenants } from './control.js';
import { members } from './org.js';

export const xpReason = pgEnum('xp_reason', [
  'task_completed',
  'on_time',
  'goal_checkin',
  'reversal',
  'kudos_received',
  'helped',
]);
export const streakStatus = pgEnum('streak_status', [
  'completed',
  'missed',
  'excused_leave',
  'excused_holiday',
  'off_day',
]);

/** Never changed or deleted (RLS grants insert only); a reversal is a negative row. */
export const xpLedger = pgTable(
  'xp_ledger',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    amount: integer('amount').notNull(),
    reason: xpReason('reason').notNull(),
    /** What earned it, e.g. `task:<id>:<completed at>`; unique with the reason. */
    sourceKey: text('source_key').notNull(),
    taskId: uuid('task_id'),
    /** The company's calendar day it counts on (for the daily cap). */
    day: date('day', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('xp_ledger_source_key').on(t.tenantId, t.reason, t.sourceKey),
    check('xp_ledger_sign', sql`(${t.reason} = 'reversal') = (${t.amount} < 0)`),
    foreignKey({
      name: 'xp_ledger_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    index('xp_ledger_member_idx').on(t.tenantId, t.memberId, t.day),
    index('xp_ledger_task_idx').on(t.tenantId, t.taskId),
  ],
);

/** A closed day; only `missed` may later become `excused_leave` (restrictive RLS policy). */
export const streakDays = pgTable(
  'streak_days',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    status: streakStatus('status').notNull(),
    planned: integer('planned').notNull().default(0),
    done: integer('done').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId, t.day] }),
    foreignKey({
      name: 'streak_days_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

/** A cache, rebuilt from the two tables above by `rebuildMemberStats`. */
export const memberStats = pgTable(
  'member_stats',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    xpTotal: integer('xp_total').notNull().default(0),
    /** The highest level ever reached: a level is celebrated once, not again after a take-back. */
    bestLevel: integer('best_level').notNull().default(1),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    /** The latest closed day the streak counts. */
    streakThrough: date('streak_through', { mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId] }),
    foreignKey({
      name: 'member_stats_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

export const valueTag = pgEnum('value_tag', [
  'teamwork',
  'help',
  'quality',
  'speed',
  'learning',
  'initiative',
]);

/**
 * A colleague's thanks (plan phase-3-step-18b). Never edited or deleted; the receiver may hide it
 * from their profile (`hidden_at`, the only change a restrictive RLS policy allows).
 */
export const kudos = pgTable(
  'kudos',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    fromMemberId: uuid('from_member_id').notNull(),
    toMemberId: uuid('to_member_id').notNull(),
    valueTag: valueTag('value_tag').notNull(),
    message: text('message').notNull(),
    taskId: uuid('task_id'),
    private: boolean('private').notNull().default(false),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    /** Saturday of the giver's Jalali week (the allowance). */
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('kudos_not_self', sql`${t.fromMemberId} <> ${t.toMemberId}`),
    foreignKey({
      name: 'kudos_from_fk',
      columns: [t.tenantId, t.fromMemberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'kudos_to_fk',
      columns: [t.tenantId, t.toMemberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'kudos_task_fk',
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }).onDelete('restrict'),
    index('kudos_to_idx').on(t.tenantId, t.toMemberId, t.id),
    index('kudos_from_week_idx').on(t.tenantId, t.fromMemberId, t.weekStart),
  ],
);

/** What badges count (written only by the worker). */
export const memberCounters = pgTable(
  'member_counters',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    counterKey: text('counter_key').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId, t.counterKey] }),
    foreignKey({
      name: 'member_counters_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

/** A badge earned for good (insert-only). */
export const memberBadges = pgTable(
  'member_badges',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    badgeKey: text('badge_key').notNull(),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId, t.badgeKey] }),
    foreignKey({
      name: 'member_badges_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);
