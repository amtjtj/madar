import { z } from 'zod';

import { attachment } from '../files.js';
import { RANK_REASONS, TASK_SOURCES } from '../task-priority.js';
import { PROGRESS_STEP, TASK_PROGRESS_MODES } from '../task-progress.js';

/** Core default workflow until department templates provide their own (ADR 0004). */
export const STATUS_CATEGORIES = ['todo', 'in_progress', 'done', 'canceled'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const DEFAULT_WORKFLOW: ReadonlyArray<{ key: string; category: StatusCategory }> = [
  { key: 'todo', category: 'todo' },
  { key: 'in_progress', category: 'in_progress' },
  { key: 'done', category: 'done' },
  { key: 'canceled', category: 'canceled' },
];

export function categoryOf(statusKey: string): StatusCategory | null {
  return DEFAULT_WORKFLOW.find((s) => s.key === statusKey)?.category ?? null;
}

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** A calendar date, YYYY-MM-DD (no time zone). */
export const calendarDate = z.iso.date();

const personRef = z.object({ id: z.uuid(), displayName: z.string() });

/** The key result a task or project serves (null when none, or the viewer cannot see its goal). */
const keyResultRef = z
  .object({ id: z.uuid(), title: z.string(), goal: z.object({ id: z.uuid(), title: z.string() }) })
  .nullable();
export type KeyResultRef = z.infer<typeof keyResultRef>;

export const task = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  department: z.object({ id: z.uuid(), name: z.string() }),
  project: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  parentId: z.uuid().nullable(),
  /** Work item type from the department config (ADR 0004). */
  typeKey: z.string(),
  statusKey: z.string(),
  statusCategory: z.enum(STATUS_CATEGORIES),
  /** Custom field values by field key (plan phase-3-step-19a). */
  customFields: z.record(z.string(), z.unknown()),
  priority: z.enum(TASK_PRIORITIES),
  assignee: personRef.nullable(),
  reporter: personRef,
  collaborators: z.array(personRef.extend({ kind: z.enum(['collaborator', 'watcher']) })),
  dueOn: calendarDate.nullable(),
  completedAt: z.iso.datetime().nullable(),
  weight: z.number().int().min(1).max(5),
  sortKey: z.string(),
  version: z.number().int(),
  subtasks: z.object({ total: z.number().int(), done: z.number().int() }),
  /** 0..100 as people see it (a finished task is 100; ADR 0018). */
  progress: z.number().int().min(0).max(100),
  /** With subtasks: computed from them (auto) or recorded by hand (manual). */
  progressMode: z.enum(TASK_PROGRESS_MODES),
  commentCount: z.number().int(),
  /** Files on the task itself and on its comments (ADR 0019). */
  attachmentCount: z.number().int(),
  /** Letters (later minutes, messages) pinned as «شاهد کار» (ADR 0021). */
  evidenceCount: z.number().int(),
  keyResult: keyResultRef,
  /** Where the task came from (ADR 0017); null until it first has an assignee. */
  source: z
    .object({
      kind: z.enum(TASK_SOURCES),
      by: personRef.extend({ title: z.string().nullable() }).nullable(),
      /** Assigned by the CEO (no manager above, executive or owner role) at the time. */
      ceo: z.boolean(),
    })
    .nullable(),
  /**
   * The meeting whose decision this task came from (ADR 0023): a link only if visible; a
   * one-on-one the viewer cannot open has no title (only its two people know it).
   */
  meeting: z
    .object({ id: z.uuid(), title: z.string().nullable(), visible: z.boolean() })
    .nullable(),
  /** Automatic priority (company weights) and why, strongest reason first. */
  rank: z.object({ score: z.number(), reasons: z.array(z.enum(RANK_REASONS)) }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** What the viewer may do (UI hints; the API enforces). */
  can: z.object({ edit: z.boolean(), setWeight: z.boolean(), delete: z.boolean() }),
});
export type Task = z.infer<typeof task>;

const customFieldsInput = z
  .record(z.string().max(40), z.unknown())
  .refine((v) => Object.keys(v).length <= 30);

const titleSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().max(10_000).nullable();

export const createTaskRequest = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
  /** Defaults to the creator's primary department. */
  departmentId: z.uuid().optional(),
  projectId: z.uuid().nullable().optional(),
  parentId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueOn: calendarDate.nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  weight: z.number().int().min(1).max(5).optional(),
  statusKey: z.string().max(40).optional(),
  /** Defaults to the department's first work item type. */
  typeKey: z.string().max(40).optional(),
  customFields: customFieldsInput.optional(),
  /** Also put the new task on today's plan. */
  addToToday: z.boolean().optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequest>;

export const updateTaskRequest = z.object({
  /** The version the client last saw; a mismatch returns version_conflict. */
  version: z.number().int().positive(),
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  projectId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueOn: calendarDate.nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  weight: z.number().int().min(1).max(5).optional(),
  statusKey: z.string().max(40).optional(),
  /** Instead of statusKey: the department's first status of this category for the task's type. */
  statusCategory: z.enum(STATUS_CATEGORIES).optional(),
  typeKey: z.string().max(40).optional(),
  /** Merged into the stored values; null clears a field. */
  customFields: customFieldsInput.optional(),
  keyResultId: z.uuid().nullable().optional(),
  progressMode: z.enum(TASK_PROGRESS_MODES).optional(),
});
export type UpdateTaskRequest = z.infer<typeof updateTaskRequest>;

/** Record progress (ADR 0018): steps of 5, with an optional short note for the history. */
export const setTaskProgressRequest = z.object({
  version: z.number().int().positive(),
  value: z.number().int().min(0).max(100).multipleOf(PROGRESS_STEP),
  note: z.string().trim().max(280).optional(),
});
export type SetTaskProgressRequest = z.infer<typeof setTaskProgressRequest>;

/** Change status and/or position on a board: place between two neighbours (either may be null). */
export const moveTaskRequest = z.object({
  statusKey: z.string().max(40),
  afterTaskId: z.uuid().nullable().optional(),
  beforeTaskId: z.uuid().nullable().optional(),
});
export type MoveTaskRequest = z.infer<typeof moveTaskRequest>;

export const setCollaboratorsRequest = z.object({
  members: z
    .array(z.object({ memberId: z.uuid(), kind: z.enum(['collaborator', 'watcher']) }))
    .max(30),
});
export type SetCollaboratorsRequest = z.infer<typeof setCollaboratorsRequest>;

/** Someone a task may be given to (plan phase-3-step-17a). */
export const assigneeOption = z.object({ id: z.uuid(), displayName: z.string() });
export type AssigneeOption = z.infer<typeof assigneeOption>;

/** In a project: who sees it; outside one: me and the people in departments I manage. */
export const listAssigneesQuery = z.object({ projectId: z.uuid().optional() });
export type ListAssigneesQuery = z.infer<typeof listAssigneesQuery>;

export const listTasksQuery = z.object({
  /** mine: assigned to me · department: my departments · project: one project · visible: everything I can see */
  view: z.enum(['mine', 'department', 'project', 'visible']).default('mine'),
  departmentId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  status: z.enum(['open', 'done', 'all']).default('open'),
  q: z.string().trim().max(80).optional(),
  /** Only tasks the person may edit (choosing a task to pin a letter to). */
  editable: z.enum(['true']).optional(),
  /** Dashboard drill-downs: the same rows the card counted (subtasks included). */
  due: z.enum(['overdue']).optional(),
  stuck: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Include subtasks in the department view (dashboard counts include them). */
  subtasks: z.enum(['include']).optional(),
  source: z.enum(TASK_SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListTasksQuery = z.infer<typeof listTasksQuery>;

export const comment = z.object({
  id: z.uuid(),
  author: personRef,
  body: z.string(),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  deleted: z.boolean(),
  attachments: z.array(attachment),
  can: z.object({ edit: z.boolean() }),
});
export type Comment = z.infer<typeof comment>;

export const commentBody = z.object({ body: z.string().trim().min(1).max(5000) });
/** A new comment may carry the person's own fresh uploads (ADR 0019). */
export const createCommentRequest = commentBody.extend({
  attachmentIds: z.array(z.uuid()).max(10).optional(),
});
export type CreateCommentRequest = z.infer<typeof createCommentRequest>;
export type CommentBody = z.infer<typeof commentBody>;

export const activity = z.object({
  id: z.uuid(),
  actor: personRef.nullable(),
  verb: z.string(),
  changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })).nullable(),
  createdAt: z.iso.datetime(),
});
export type Activity = z.infer<typeof activity>;

export const PROJECT_VISIBILITIES = ['department', 'tenant', 'private'] as const;
/** Observers see the project (also a private one) and comment, but add no work to it. */
export const PROJECT_ROLES = ['owner', 'member', 'observer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const project = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  department: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  status: z.enum(['active', 'archived']),
  visibility: z.enum(PROJECT_VISIBILITIES),
  owner: personRef,
  color: z.string().nullable(),
  startOn: calendarDate.nullable(),
  dueOn: calendarDate.nullable(),
  /** Top-level tasks the viewer sees; `progress` is their weighted progress, 0..1 (ADR 0018). */
  tasks: z.object({ total: z.number().int(), done: z.number().int(), progress: z.number() }),
  members: z.array(personRef.extend({ role: z.enum(PROJECT_ROLES) })),
  keyResult: keyResultRef,
  can: z.object({ edit: z.boolean(), createTask: z.boolean() }),
});
export type Project = z.infer<typeof project>;

export const createProjectRequest = z.object({
  name: z.string().trim().min(2).max(120),
  description: descriptionSchema.optional(),
  departmentId: z.uuid().nullable().optional(),
  visibility: z.enum(PROJECT_VISIBILITIES).default('department'),
  color: z.string().max(20).nullable().optional(),
  startOn: calendarDate.nullable().optional(),
  dueOn: calendarDate.nullable().optional(),
  memberIds: z.array(z.uuid()).max(100).optional(),
});
export type CreateProjectRequest = z.input<typeof createProjectRequest>;

export const updateProjectRequest = createProjectRequest
  .omit({ memberIds: true })
  .partial()
  .extend({ keyResultId: z.uuid().nullable().optional() });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequest>;

export const setProjectMembersRequest = z.object({
  members: z.array(z.object({ memberId: z.uuid(), role: z.enum(PROJECT_ROLES) })).max(200),
});
export type SetProjectMembersRequest = z.infer<typeof setProjectMembersRequest>;

export const TODAY_SUGGESTION_REASONS = [
  'from_yesterday',
  'overdue',
  'due_today',
  'in_progress',
] as const;
export type TodaySuggestionReason = (typeof TODAY_SUGGESTION_REASONS)[number];

/** The member's plan for their local day, plus tasks they may want to add (never auto-added). */
export const today = z.object({
  /** The tenant-local calendar day. */
  date: calendarDate,
  /** In the member's own order where they set one; the rest placed by priority (ADR 0017). */
  items: z.array(task),
  /** The member ordered today by hand (offer «automatic order»). */
  ordered: z.boolean(),
  progress: z.object({ done: z.number().int(), total: z.number().int() }),
  suggestions: z.array(z.object({ reason: z.enum(TODAY_SUGGESTION_REASONS), task })),
});
export type Today = z.infer<typeof today>;

/** Replace today's plan with these tasks, in this order. */
export const setTodayItemsRequest = z.object({ taskIds: z.array(z.uuid()).max(50) });
/** A member's own order of «my tasks» (drag and drop). */
export const setTaskOrderRequest = z.object({ taskIds: z.array(z.uuid()).max(500) });
export type SetTaskOrderRequest = z.infer<typeof setTaskOrderRequest>;
export type SetTodayItemsRequest = z.infer<typeof setTodayItemsRequest>;
