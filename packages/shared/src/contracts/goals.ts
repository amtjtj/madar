import { z } from 'zod';

import { calendarDate } from './work.js';

/** Three levels with an alignment chain upwards (ADR 0013). */
export const GOAL_LEVELS = ['company', 'department', 'individual'] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

/** The level a goal's parent must have; company goals have no parent. */
export const PARENT_LEVELS: Record<GoalLevel, readonly GoalLevel[]> = {
  company: [],
  department: ['company'],
  individual: ['department', 'company'],
};

/** `percent` is a number from 0 to 100; `boolean` is done or not done. */
export const KEY_RESULT_KINDS = ['number', 'percent', 'boolean'] as const;
export type KeyResultKind = (typeof KEY_RESULT_KINDS)[number];

export const CHECKIN_STATUSES = ['on_track', 'at_risk', 'off_track'] as const;
export type CheckinStatus = (typeof CHECKIN_STATUSES)[number];

const personRef = z.object({ id: z.uuid(), displayName: z.string() });
const titleSchema = z.string().trim().min(1).max(200);
const value = z.number().finite().min(-1e12).max(1e12);

export const goalPeriod = z.object({
  id: z.uuid(),
  year: z.number().int(),
  quarter: z.number().int().min(1).max(4),
  startOn: calendarDate,
  endOn: calendarDate,
  current: z.boolean(),
});
export type GoalPeriod = z.infer<typeof goalPeriod>;

export const keyResult = z.object({
  id: z.uuid(),
  goalId: z.uuid(),
  title: z.string(),
  kind: z.enum(KEY_RESULT_KINDS),
  startValue: z.number(),
  targetValue: z.number(),
  currentValue: z.number(),
  unit: z.string().nullable(),
  weight: z.number().int().min(1).max(5),
  /** 0..1 */
  progress: z.number(),
  status: z.enum(CHECKIN_STATUSES).nullable(),
  lastCheckinAt: z.iso.datetime().nullable(),
  /** Work linked to this key result (visible to the viewer). */
  linked: z.object({
    tasks: z.object({ total: z.number().int(), done: z.number().int() }),
    projects: z.number().int(),
  }),
});
export type KeyResult = z.infer<typeof keyResult>;

export const goalSummary = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  level: z.enum(GOAL_LEVELS),
  department: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  owner: personRef,
  /** Null when there is none or the viewer may not see it. */
  parent: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  title: z.string(),
  progress: z.number(),
  status: z.enum(CHECKIN_STATUSES).nullable(),
  completedAt: z.iso.datetime().nullable(),
  keyResultCount: z.number().int(),
  childCount: z.number().int(),
  can: z.object({ edit: z.boolean() }),
});
export type GoalSummary = z.infer<typeof goalSummary>;

const linkedTask = z.object({
  id: z.uuid(),
  title: z.string(),
  keyResultId: z.uuid(),
  statusCategory: z.enum(['todo', 'in_progress', 'done', 'canceled']),
  assignee: personRef.nullable(),
});
const linkedProject = z.object({ id: z.uuid(), name: z.string(), keyResultId: z.uuid() });

export const goalDetail = goalSummary.extend({
  description: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  keyResults: z.array(keyResult),
  children: z.array(goalSummary),
  tasks: z.array(linkedTask),
  projects: z.array(linkedProject),
});
export type GoalDetail = z.infer<typeof goalDetail>;

export const checkin = z.object({
  id: z.uuid(),
  keyResultId: z.uuid(),
  value: z.number(),
  status: z.enum(CHECKIN_STATUSES),
  note: z.string().nullable(),
  author: personRef,
  createdAt: z.iso.datetime(),
});
export type Checkin = z.infer<typeof checkin>;

export const listGoalsQuery = z.object({
  periodId: z.uuid().optional(),
  view: z.enum(['mine', 'department', 'company']).default('mine'),
  /** With `department`: one department instead of all of mine (dashboard drill-down). */
  departmentId: z.uuid().optional(),
});
export type ListGoalsQuery = z.infer<typeof listGoalsQuery>;

const keyResultFields = z.object({
  title: titleSchema,
  kind: z.enum(KEY_RESULT_KINDS),
  startValue: value.optional(),
  targetValue: value.optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  weight: z.number().int().min(1).max(5).optional(),
});

/** Fills kind defaults: percent 0 → 100, boolean 0 → 1, number needs start ≠ target. */
export function keyResultRange(input: {
  kind: KeyResultKind;
  startValue?: number;
  targetValue?: number;
}): { startValue: number; targetValue: number } | null {
  if (input.kind === 'boolean') return { startValue: 0, targetValue: 1 };
  const startValue = input.startValue ?? 0;
  const targetValue = input.targetValue ?? (input.kind === 'percent' ? 100 : NaN);
  if (!Number.isFinite(targetValue) || startValue === targetValue) return null;
  if (input.kind === 'percent' && [startValue, targetValue].some((v) => v < 0 || v > 100)) {
    return null;
  }
  return { startValue, targetValue };
}

export const newKeyResultRequest = keyResultFields.refine((kr) => keyResultRange(kr) !== null, {
  message: 'invalid range',
  path: ['targetValue'],
});
export type NewKeyResultRequest = z.infer<typeof newKeyResultRequest>;

export const updateKeyResultRequest = keyResultFields
  .omit({ kind: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateKeyResultRequest = z.infer<typeof updateKeyResultRequest>;

export const createGoalRequest = z.object({
  periodId: z.uuid(),
  level: z.enum(GOAL_LEVELS),
  /** Required for department and individual goals; defaults to the creator's primary one. */
  departmentId: z.uuid().optional(),
  /** Defaults to the creator. */
  ownerId: z.uuid().optional(),
  parentId: z.uuid().nullable().optional(),
  title: titleSchema,
  description: z.string().trim().max(5_000).nullable().optional(),
  keyResults: z.array(newKeyResultRequest).max(10).default([]),
});
export type CreateGoalRequest = z.input<typeof createGoalRequest>;

export const updateGoalRequest = z
  .object({
    title: titleSchema,
    description: z.string().trim().max(5_000).nullable(),
    ownerId: z.uuid(),
    parentId: z.uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateGoalRequest = z.infer<typeof updateGoalRequest>;

export const createCheckinRequest = z.object({
  value,
  status: z.enum(CHECKIN_STATUSES),
  note: z.string().trim().max(2_000).nullable().optional(),
});
export type CreateCheckinRequest = z.infer<typeof createCheckinRequest>;

/** Picker entry for linking a task or project to a key result. */
export const keyResultOption = z.object({
  id: z.uuid(),
  title: z.string(),
  goal: z.object({ id: z.uuid(), title: z.string(), level: z.enum(GOAL_LEVELS) }),
});
export type KeyResultOption = z.infer<typeof keyResultOption>;

export const keyResultOptionsQuery = z.object({ q: z.string().trim().max(100).optional() });
