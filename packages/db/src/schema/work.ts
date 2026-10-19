/**
 * Work core (phase 1, step 5): projects, tasks, comments, activity, today plan, domain events.
 * Data plane: tenant_id, forced RLS (drizzle/*_work_rls.sql) and composite (tenant_id, x) FKs.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
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

export const projectVisibility = pgEnum('project_visibility', ['department', 'tenant', 'private']);
export const projectStatus = pgEnum('project_status', ['active', 'archived']);
export const projectRole = pgEnum('project_role', ['owner', 'member', 'observer']);
export const statusCategory = pgEnum('status_category', [
  'todo',
  'in_progress',
  'done',
  'canceled',
]);
export const taskPriority = pgEnum('task_priority', ['low', 'normal', 'high', 'urgent']);
export const collaboratorKind = pgEnum('collaborator_kind', ['collaborator', 'watcher']);
/** Where a task came from (plan phase-2-step-10a, ADR 0017); set once, never changed. */
export const taskSource = pgEnum('task_source', ['personal', 'assigned', 'request', 'meeting']);
/** With subtasks: progress computed from them, or recorded by hand (ADR 0018). */
export const taskProgressMode = pgEnum('task_progress_mode', ['auto', 'manual']);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id'),
    name: text('name').notNull(),
    description: text('description'),
    status: projectStatus('status').notNull().default('active'),
    visibility: projectVisibility('visibility').notNull().default('department'),
    ownerId: uuid('owner_id').notNull(),
    color: text('color'),
    startOn: date('start_on', { mode: 'string' }),
    dueOn: date('due_on', { mode: 'string' }),
    /** The key result this project serves (step 7). */
    keyResultId: uuid('key_result_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('projects_tenant_id_id_key').on(t.tenantId, t.id),
    index('projects_tenant_key_result_idx').on(t.tenantId, t.keyResultId),
    foreignKey({
      name: 'projects_key_result_fk',
      columns: [t.tenantId, t.keyResultId],
      foreignColumns: [keyResults.tenantId, keyResults.id],
    }),
    index('projects_tenant_department_idx').on(t.tenantId, t.departmentId),
    foreignKey({
      name: 'projects_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'projects_owner_fk',
      columns: [t.tenantId, t.ownerId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

export const projectMembers = pgTable(
  'project_members',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    memberId: uuid('member_id').notNull(),
    role: projectRole('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.projectId, t.memberId] }),
    index('project_members_member_idx').on(t.tenantId, t.memberId),
    foreignKey({
      name: 'project_members_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_members_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('cascade'),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').notNull(),
    projectId: uuid('project_id'),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    description: text('description'),
    /** Work item type from the department config (ADR 0004); core default is "task". */
    typeKey: text('type_key').notNull().default('task'),
    statusKey: text('status_key').notNull().default('todo'),
    statusCategory: statusCategory('status_category').notNull().default('todo'),
    priority: taskPriority('priority').notNull().default('normal'),
    assigneeId: uuid('assignee_id'),
    reporterId: uuid('reporter_id').notNull(),
    /** Calendar date (no time zone); "today"/"overdue" use the tenant's time zone. */
    dueOn: date('due_on', { mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** 1–5, set by department managers; basis for XP later (ADR 0007). */
    weight: smallint('weight').notNull().default(1),
    sortKey: text('sort_key').notNull().default('a0'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Optimistic concurrency: incremented on every update. */
    version: integer('version').notNull().default(1),
    /** The key result this task serves (step 7). */
    keyResultId: uuid('key_result_id'),
    /** Null until the task first has an assignee. */
    source: taskSource('source'),
    /** Who set that first assignee. */
    sourceMemberId: uuid('source_member_id'),
    /** That person was the CEO at the time (no manager above, executive or owner role). */
    sourceCeo: boolean('source_ceo').notNull().default(false),
    /** 0..100 in steps of 5, as last recorded (a finished task shows 100; ADR 0018). */
    progress: smallint('progress').notNull().default(0),
    progressMode: taskProgressMode('progress_mode').notNull().default('auto'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('tasks_tenant_id_id_key').on(t.tenantId, t.id),
    check('tasks_progress_step', sql`${t.progress} between 0 and 100 and ${t.progress} % 5 = 0`),
    index('tasks_tenant_source_idx').on(t.tenantId, t.source),
    foreignKey({
      name: 'tasks_source_member_fk',
      columns: [t.tenantId, t.sourceMemberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    index('tasks_tenant_key_result_idx').on(t.tenantId, t.keyResultId),
    foreignKey({
      name: 'tasks_key_result_fk',
      columns: [t.tenantId, t.keyResultId],
      foreignColumns: [keyResults.tenantId, keyResults.id],
    }),
    index('tasks_tenant_department_status_idx').on(t.tenantId, t.departmentId, t.statusCategory),
    index('tasks_tenant_assignee_status_idx').on(t.tenantId, t.assigneeId, t.statusCategory),
    index('tasks_tenant_project_idx').on(t.tenantId, t.projectId),
    index('tasks_tenant_parent_idx').on(t.tenantId, t.parentId),
    index('tasks_tenant_due_idx').on(t.tenantId, t.dueOn),
    // «Done per week» on the dashboards.
    index('tasks_tenant_completed_idx')
      .on(t.tenantId, t.completedAt)
      .where(sql`${t.deletedAt} is null`),
    foreignKey({
      name: 'tasks_department_fk',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tasks_project_fk',
      columns: [t.tenantId, t.projectId],
      foreignColumns: [projects.tenantId, projects.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tasks_parent_fk',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tasks_assignee_fk',
      columns: [t.tenantId, t.assigneeId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tasks_reporter_fk',
      columns: [t.tenantId, t.reporterId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

export const taskCollaborators = pgTable(
  'task_collaborators',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull(),
    memberId: uuid('member_id').notNull(),
    kind: collaboratorKind('kind').notNull().default('collaborator'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.taskId, t.memberId] }),
    index('task_collaborators_member_idx').on(t.tenantId, t.memberId),
    foreignKey({
      name: 'task_collaborators_task_fk',
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'task_collaborators_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('cascade'),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    /** Polymorphic subject (only "task" for now); integrity is checked by the API. */
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('comments_tenant_subject_idx').on(t.tenantId, t.subjectType, t.subjectId, t.createdAt),
    foreignKey({
      name: 'comments_author_fk',
      columns: [t.tenantId, t.authorId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

/** User-visible history of a subject (different from the security audit log). Append-only. */
export const activities = pgTable(
  'activities',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    actorId: uuid('actor_id'),
    verb: text('verb').notNull(),
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    index('activities_tenant_subject_idx').on(t.tenantId, t.subjectType, t.subjectId, t.createdAt),
    foreignKey({
      name: 'activities_actor_fk',
      columns: [t.tenantId, t.actorId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('restrict'),
  ],
);

export const dailyPlanItems = pgTable(
  'daily_plan_items',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    /** The member's local calendar day (tenant time zone). */
    planDate: date('plan_date', { mode: 'string' }).notNull(),
    taskId: uuid('task_id').notNull(),
    /** Set when the member ordered the plan by hand; null = placed by priority score. */
    sortKey: text('sort_key'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId, t.planDate, t.taskId] }),
    index('daily_plan_items_task_idx').on(t.tenantId, t.taskId),
    foreignKey({
      name: 'daily_plan_items_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'daily_plan_items_task_fk',
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }).onDelete('cascade'),
  ],
);

/** A member's own order of «my tasks» (drag and drop); only they read or change it. */
export const memberTaskOrder = pgTable(
  'member_task_order',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    taskId: uuid('task_id').notNull(),
    sortKey: text('sort_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.memberId, t.taskId] }),
    index('member_task_order_task_idx').on(t.tenantId, t.taskId),
    foreignKey({
      name: 'member_task_order_member_fk',
      columns: [t.tenantId, t.memberId],
      foreignColumns: [members.tenantId, members.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_task_order_task_fk',
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }).onDelete('cascade'),
  ],
);

/** Transactional outbox (architecture §5): written with the change, published by a worker later. */
export const domainEvents = pgTable(
  'domain_events',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    version: smallint('version').notNull().default(1),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    actorId: uuid('actor_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    index('domain_events_unpublished_idx')
      .on(t.tenantId, t.occurredAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);
