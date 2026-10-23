/**
 * Requests and approvals (plan phase-3-step-17b, ADR 0028): a request of a fixed kind, its approval
 * steps (append-only) and the leaves an approved leave request makes. `data` follows the kind's
 * form in shared; `snapshot` keeps the approvers worked out when it was made.
 * Data plane: tenant_id, forced RLS (drizzle/*_requests.sql) and composite (tenant_id, x) FKs.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, tenantId } from './columns.js';
import { tenants } from './control.js';
import { departments, members } from './org.js';

export const requestKind = pgEnum('request_kind', ['leave', 'expense', 'general']);
export const requestStatus = pgEnum('request_status', [
  'pending',
  'approved',
  'rejected',
  'canceled',
]);
export const requestDecision = pgEnum('request_decision', ['approved', 'rejected']);
export const leaveKind = pgEnum('leave_kind', ['daily', 'hourly']);

export interface RequestSnapshot {
  /** Approver of each step, in order. */
  approvers: string[];
  /** The company's expense threshold when it was made (expense only). */
  thresholdToman?: number;
}

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    kind: requestKind('kind').notNull(),
    requesterId: uuid('requester_id').notNull(),
    /** The requester's primary department when it was made. */
    departmentId: uuid('department_id').notNull(),
    title: text('title').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    /** Rials, expense only (whole tomans × 10). */
    amountRial: bigint('amount_rial', { mode: 'number' }),
    status: requestStatus('status').notNull().default('pending'),
    currentStep: integer('current_step').notNull().default(0),
    snapshot: jsonb('snapshot').$type<RequestSnapshot>().notNull(),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    unique('approval_requests_tenant_id_id_key').on(t.tenantId, t.id),
    check(
      'approval_requests_amount_by_kind',
      sql`(${t.kind} = 'expense') = (${t.amountRial} is not null)`,
    ),
    check('approval_requests_decided', sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`),
    foreignKey({
      name: 'approval_requests_requester_fk',
      columns: [t.tenantId, t.requesterId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'approval_requests_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }).onDelete('restrict'),
    index('approval_requests_requester_idx').on(t.tenantId, t.requesterId),
    index('approval_requests_status_idx').on(t.tenantId, t.status),
  ],
);

/** One decision per step, never changed or deleted (RLS grants insert only). */
export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').notNull(),
    stepIndex: integer('step_index').notNull(),
    /** The step's approver from the snapshot. */
    approverId: uuid('approver_id').notNull(),
    /** Who decided: the approver, or the leadership standing in for an inactive one. */
    decidedBy: uuid('decided_by').notNull(),
    decision: requestDecision('decision').notNull(),
    comment: text('comment').notNull().default(''),
    decidedAt: createdAt(),
  },
  (t) => [
    unique('approval_steps_request_step_key').on(t.tenantId, t.requestId, t.stepIndex),
    foreignKey({
      name: 'approval_steps_request_fk',
      columns: [t.tenantId, t.requestId],
      foreignColumns: [approvalRequests.tenantId, approvalRequests.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'approval_steps_approver_fk',
      columns: [t.tenantId, t.approverId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'approval_steps_decided_by_fk',
      columns: [t.tenantId, t.decidedBy],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

/** An approved leave, made in the final approval's transaction. */
export const leaves = pgTable(
  'leaves',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    requestId: uuid('request_id').notNull(),
    kind: leaveKind('kind').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    /** Hourly leaves only. */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('leaves_request_key').on(t.tenantId, t.requestId),
    check('leaves_dates', sql`${t.endsOn} >= ${t.startsOn}`),
    check(
      'leaves_times_by_kind',
      sql`(${t.kind} = 'hourly') = (${t.startsAt} is not null and ${t.endsAt} is not null)`,
    ),
    foreignKey({
      name: 'leaves_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'leaves_request_fk',
      columns: [t.tenantId, t.requestId],
      foreignColumns: [approvalRequests.tenantId, approvalRequests.id],
    }).onDelete('restrict'),
    index('leaves_member_dates_idx').on(t.tenantId, t.memberId, t.startsOn),
  ],
);
