/**
 * Background work and notifications (phase 1, step 6): work calendar (quiet hours), notifications,
 * per-member preferences and consumer idempotency for the event outbox.
 * Data plane: tenant_id, forced RLS (drizzle/*_notify_rls.sql) and composite (tenant_id, x) FKs.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId, updatedAt } from './columns.js';
import { tenants } from './control.js';
import { members } from './org.js';

/** Working hours of one weekday (local time, "HH:MM"), or null when the day is off. */
export type DayHours = { start: string; end: string } | null;

/** One row per tenant; no row means the product default (see `DEFAULT_WORK_CALENDAR` in shared). */
export const workCalendars = pgTable('work_calendars', {
  tenantId: tenantId()
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Seven entries, Saturday first. */
  weeklyHours: jsonb('weekly_hours').$type<DayHours[]>().notNull(),
  holidays: date('holidays', { mode: 'string' })
    .array()
    .notNull()
    .default(sql`'{}'::date[]`),
  /** Working days past due before department managers are told; 0 turns it off. */
  overdueEscalationDays: smallint('overdue_escalation_days').notNull().default(2),
  updatedAt: updatedAt(),
});

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id').notNull(),
    kind: text('kind').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    actorId: uuid('actor_id'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** One notification per recipient and key (event id + kind, or task + reminder + day). */
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: createdAt(),
    /** Quiet hours: not pushed before this instant (the in-app list shows it at once). */
    deliverAfter: timestamp('deliver_after', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** When a device push covered this notification (or it was skipped); never pushed twice. */
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
  },
  (t) => [
    unique('notifications_tenant_id_id_key').on(t.tenantId, t.id),
    unique('notifications_recipient_dedupe_key').on(t.tenantId, t.recipientId, t.dedupeKey),
    index('notifications_recipient_created_idx').on(t.tenantId, t.recipientId, t.createdAt),
    index('notifications_recipient_unread_idx')
      .on(t.tenantId, t.recipientId)
      .where(sql`${t.readAt} is null`),
    foreignKey({
      name: 'notifications_recipient_fk',
      columns: [t.tenantId, t.recipientId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'notifications_actor_fk',
      columns: [t.tenantId, t.actorId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

/** No row means the defaults: every kind on, nothing pushed outside working hours. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    mutedKinds: text('muted_kinds')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    offHours: boolean('off_hours').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId] }),
    foreignKey({
      name: 'notification_preferences_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('cascade'),
  ],
);

/** Consumer idempotency: an event is handled at most once per consumer. */
export const processedEvents = pgTable(
  'processed_events',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.consumer, t.eventId] })],
);

/**
 * Web Push subscriptions: one per member and browser (phase 1, step 6b). Only the member's own
 * session writes them; the worker reads them to deliver pushes.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    /** Push service URL chosen by the browser (allowlisted hosts only). */
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    /** Consecutive failed deliveries; the subscription is dropped after a few. */
    failureCount: smallint('failure_count').notNull().default(0),
  },
  (t) => [
    // One browser belongs to one member per company (the last one who signed in on it).
    unique('push_subscriptions_endpoint_key').on(t.tenantId, t.endpoint),
    foreignKey({
      name: 'push_subscriptions_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('cascade'),
  ],
);
