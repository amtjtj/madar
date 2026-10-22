/**
 * Meetings (phase 2, step 13a; ADR 0023). Seen by the organizer, the participants and the
 * departments that oversee `meeting`; a one-on-one only by its two people. A meeting is never
 * deleted (canceling is soft); a decision becomes at most one task, with source `meeting`.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('meetings_tenant_id_id_key').on(t.tenantId, t.id),
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
