/**
 * Meetings (phase 2, step 13a; ADR 0023). Seen by the organizer, the participants and the
 * departments that oversee `meeting`; a one-on-one only by its two people. A meeting is never
 * deleted (canceling is soft); a decision becomes at most one task, with source `meeting`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
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
import { keyResults } from './goals.js';
import { departments, members } from './org.js';
import { tasks } from './work.js';

export const meetingType = pgEnum('meeting_type', ['regular', 'okr_review', 'one_on_one']);
export const meetingResponse = pgEnum('meeting_response', ['pending', 'accepted', 'declined']);

/**
 * A weekly meeting (step 13b): the rule and the defaults its meetings are made from, up to
 * eight weeks ahead. Times are the company's wall clock; canceling is soft.
 */
export const meetingSeries = pgTable(
  'meeting_series',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    type: meetingType('type').notNull(),
    title: text('title').notNull(),
    /** 0 = Saturday … 6 = Friday. */
    weekday: smallint('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    untilOn: date('until_on', { mode: 'string' }),
    location: text('location'),
    link: text('link'),
    agenda: text('agenda').notNull().default(''),
    organizerId: uuid('organizer_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    /** The last day meetings were made up to. */
    generatedUntil: date('generated_until', { mode: 'string' }).notNull(),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('meeting_series_tenant_id_id_key').on(t.tenantId, t.id),
    check('meeting_series_weekday', sql`${t.weekday} between 0 and 6`),
    check('meeting_series_times', sql`${t.endTime} > ${t.startTime}`),
    check('meeting_series_until', sql`${t.untilOn} is null or ${t.untilOn} >= ${t.startsOn}`),
    foreignKey({
      name: 'meeting_series_organizer_fk',
      columns: [t.tenantId, t.organizerId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meeting_series_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }).onDelete('restrict'),
  ],
);

/** The people of a series, the organizer included; copied to each meeting made from it. */
export const meetingSeriesParticipants = pgTable(
  'meeting_series_participants',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    seriesId: uuid('series_id').notNull(),
    memberId: uuid('member_id').notNull(),
    addedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.seriesId, t.memberId] }),
    foreignKey({
      name: 'meeting_series_participants_series_fk',
      columns: [t.tenantId, t.seriesId],
      foreignColumns: [meetingSeries.tenantId, meetingSeries.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meeting_series_participants_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

export const meetings = pgTable(
  'meetings',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    type: meetingType('type').notNull(),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    location: text('location'),
    link: text('link'),
    /** Lite text (ADR 0020), never HTML. */
    agenda: text('agenda').notNull().default(''),
    organizerId: uuid('organizer_id').notNull(),
    /** The organizer's primary department when it was made (oversight, decision tasks). */
    departmentId: uuid('department_id').notNull(),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    /** A meeting of a weekly series, on that calendar day (step 13b). */
    seriesId: uuid('series_id'),
    occursOn: date('occurs_on', { mode: 'string' }),
    /** Edited on its own: later changes to the series leave it alone. */
    detached: boolean('detached').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('meetings_tenant_id_id_key').on(t.tenantId, t.id),
    unique('meetings_series_day_key').on(t.tenantId, t.seriesId, t.occursOn),
    check('meetings_series_day', sql`(${t.seriesId} is null) = (${t.occursOn} is null)`),
    foreignKey({
      name: 'meetings_series_fk',
      columns: [t.tenantId, t.seriesId],
      foreignColumns: [meetingSeries.tenantId, meetingSeries.id],
    }).onDelete('restrict'),
    index('meetings_tenant_starts_idx').on(t.tenantId, t.startsAt),
    check('meetings_ends_after_start', sql`${t.endsAt} > ${t.startsAt}`),
    foreignKey({
      name: 'meetings_organizer_fk',
      columns: [t.tenantId, t.organizerId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meetings_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }).onDelete('restrict'),
  ],
);

/** Everyone taking part, the organizer included. */
export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id').notNull(),
    memberId: uuid('member_id').notNull(),
    addedAt: createdAt(),
    response: meetingResponse('response').notNull().default('pending'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.meetingId, t.memberId] }),
    index('meeting_participants_member_idx').on(t.tenantId, t.memberId),
    foreignKey({
      name: 'meeting_participants_meeting_fk',
      columns: [t.tenantId, t.meetingId],
      foreignColumns: [meetings.tenantId, meetings.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meeting_participants_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

/** One per meeting; its files are attachments with subject `minutes` and this row's id. */
export const meetingMinutes = pgTable(
  'meeting_minutes',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id').notNull(),
    body: text('body').notNull().default(''),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: createdAt(),
    updatedBy: uuid('updated_by').notNull(),
    updatedAt: updatedAt(),
    /** Optimistic concurrency between people writing at the same time. */
    version: integer('version').notNull().default(1),
  },
  (t) => [
    unique('meeting_minutes_tenant_id_id_key').on(t.tenantId, t.id),
    unique('meeting_minutes_meeting_key').on(t.tenantId, t.meetingId),
    foreignKey({
      name: 'meeting_minutes_meeting_fk',
      columns: [t.tenantId, t.meetingId],
      foreignColumns: [meetings.tenantId, meetings.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meeting_minutes_recorded_by_fk',
      columns: [t.tenantId, t.recordedBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meeting_minutes_updated_by_fk',
      columns: [t.tenantId, t.updatedBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

export const meetingDecisions = pgTable(
  'meeting_decisions',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    meetingId: uuid('meeting_id').notNull(),
    text: text('text').notNull(),
    /** The task made from it (once); the task's link back to the meeting. */
    taskId: uuid('task_id'),
    keyResultId: uuid('key_result_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('meeting_decisions_meeting_idx').on(t.tenantId, t.meetingId),
    unique('meeting_decisions_task_key').on(t.tenantId, t.taskId),
    foreignKey({
      name: 'meeting_decisions_meeting_fk',
      columns: [t.tenantId, t.meetingId],
      foreignColumns: [meetings.tenantId, meetings.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meeting_decisions_task_fk',
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meeting_decisions_key_result_fk',
      columns: [t.tenantId, t.keyResultId],
      foreignColumns: [keyResults.tenantId, keyResults.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'meeting_decisions_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);
