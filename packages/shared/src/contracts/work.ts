import { z } from 'zod';

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

export const task = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  department: z.object({ id: z.uuid(), name: z.string() }),
  project: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  parentId: z.uuid().nullable(),
  statusKey: z.string(),
  statusCategory: z.enum(STATUS_CATEGORIES),
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
  commentCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** What the viewer may do (UI hints; the API enforces). */
  can: z.object({ edit: z.boolean(), setWeight: z.boolean(), delete: z.boolean() }),
});
export type Task = z.infer<typeof task>;

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
});
export type UpdateTaskRequest = z.infer<typeof updateTaskRequest>;

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

export const listTasksQuery = z.object({
  /** mine: assigned to me · department: my departments · project: one project · visible: everything I can see */
  view: z.enum(['mine', 'department', 'project', 'visible']).default('mine'),
  departmentId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  status: z.enum(['open', 'done', 'all']).default('open'),
  q: z.string().trim().max(80).optional(),
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
  can: z.object({ edit: z.boolean() }),
});
export type Comment = z.infer<typeof comment>;

export const commentBody = z.object({ body: z.string().trim().min(1).max(5000) });
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
  tasks: z.object({ total: z.number().int(), done: z.number().int() }),
  members: z.array(personRef.extend({ role: z.enum(['owner', 'member']) })),
  can: z.object({ edit: z.boolean() }),
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

export const updateProjectRequest = createProjectRequest.omit({ memberIds: true }).partial();
export type UpdateProjectRequest = z.infer<typeof updateProjectRequest>;

export const setProjectMembersRequest = z.object({
  members: z.array(z.object({ memberId: z.uuid(), role: z.enum(['owner', 'member']) })).max(200),
});
export type SetProjectMembersRequest = z.infer<typeof setProjectMembersRequest>;
