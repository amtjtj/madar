import { z } from 'zod';

import type { TaskPriority } from './contracts/work.js';
import { addDays } from './locale/jalali.js';
import { isWorkingDay, type WorkCalendar } from './locale/work-calendar.js';
import { weekEndOf, weekStartOf } from './dashboard-rules.js';

/**
 * Task source and automatic priority (plan phase-2-step-10a, ADR 0017). Pure functions: the API
 * feeds them data, the web shows their reasons. Nothing here ranks people; the score belongs to a
 * task.
 */

export const TASK_SOURCES = ['personal', 'assigned', 'request', 'meeting'] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export interface SourceInput {
  /** Who set the assignee (the creator, or whoever assigned it first). */
  actorId: string;
  assigneeId: string;
  /** The assignee's managers, nearest first (`members.manager_id` chain). */
  assigneeManagers: readonly string[];
  /** Heads and managers of the department the task belongs to. */
  departmentManagers: readonly string[];
  /** The actor has no manager above them and holds the executive or owner role. */
  actorIsTop: boolean;
}

/** Decided once, when a task first gets an assignee; never changes afterwards. */
export function deriveTaskSource(input: SourceInput): { source: TaskSource; ceo: boolean } {
  if (input.actorId === input.assigneeId) return { source: 'personal', ceo: false };
  const above =
    input.assigneeManagers.includes(input.actorId) ||
    input.departmentManagers.includes(input.actorId);
  if (above) return { source: 'assigned', ceo: input.actorIsTop };
  return { source: 'request', ceo: false };
}

export const DUE_BUCKETS = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number];

/** «Tomorrow» is the next working day; «this week» runs to the end of the Saturday-based week. */
export function dueBucket(dueOn: string | null, today: string, calendar: WorkCalendar): DueBucket {
  if (!dueOn) return 'none';
  if (dueOn < today) return 'overdue';
  if (dueOn === today) return 'today';
  let next = addDays(today, 1);
  for (let guard = 0; guard < 30 && !isWorkingDay(calendar, next); guard++) next = addDays(next, 1);
  if (dueOn <= next) return 'tomorrow';
  if (dueOn <= weekEndOf(weekStartOf(today))) return 'week';
  return 'later';
}

/** Coefficients in the company's settings (`tenants.settings.priority`); owners change them. */
export const priorityWeights = z.object({
  due: z.number().int().min(0).max(100),
  priority: z.number().int().min(0).max(100),
  source: z.number().int().min(0).max(100),
  keyResult: z.number().int().min(0).max(100),
  weight: z.number().int().min(0).max(100),
});
export type PriorityWeights = z.infer<typeof priorityWeights>;
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  due: 40,
  priority: 25,
  source: 20,
  keyResult: 10,
  weight: 5,
};

export const RANK_REASONS = [
  'due.overdue',
  'due.today',
  'due.tomorrow',
  'due.week',
  'priority.urgent',
  'priority.high',
  'source.ceo',
  'source.assigned',
  'source.meeting',
  'source.request',
  'keyResult',
  'weight',
] as const;
export type RankReason = (typeof RANK_REASONS)[number];

export interface RankInput {
  due: DueBucket;
  priority: TaskPriority;
  source: TaskSource | null;
  ceo: boolean;
  keyResult: boolean;
  /** 1 to 5, set by managers. */
  weight: number;
}

const DUE_VALUE: Record<DueBucket, number> = {
  overdue: 1,
  today: 0.85,
  tomorrow: 0.7,
  week: 0.5,
  later: 0.25,
  none: 0,
};
const PRIORITY_VALUE: Record<TaskPriority, number> = {
  urgent: 1,
  high: 0.66,
  normal: 0.33,
  low: 0,
};
const SOURCE_VALUE: Record<TaskSource | 'ceo', number> = {
  ceo: 1,
  assigned: 0.75,
  meeting: 0.5,
  request: 0.25,
  personal: 0,
};

/**
 * Score 0..100 (with weights summing to 100) and up to two reasons, the parts that added the most.
 * Parts that say little («due later», «normal priority», «personal») never become reasons.
 */
export function priorityScore(
  input: RankInput,
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): { score: number; reasons: RankReason[] } {
  const sourceKey = input.source === 'assigned' && input.ceo ? 'ceo' : input.source;
  const weightValue = (Math.min(5, Math.max(1, input.weight)) - 1) / 4;
  const parts: Array<{ value: number; reason: RankReason | null }> = [
    {
      value: weights.due * DUE_VALUE[input.due],
      reason: ['overdue', 'today', 'tomorrow', 'week'].includes(input.due)
        ? (`due.${input.due}` as RankReason)
        : null,
    },
    {
      value: weights.priority * PRIORITY_VALUE[input.priority],
      reason:
        input.priority === 'urgent' || input.priority === 'high'
          ? (`priority.${input.priority}` as RankReason)
          : null,
    },
    {
      value: weights.source * (sourceKey ? SOURCE_VALUE[sourceKey] : 0),
      reason: sourceKey && sourceKey !== 'personal' ? (`source.${sourceKey}` as RankReason) : null,
    },
    {
      value: input.keyResult ? weights.keyResult : 0,
      reason: input.keyResult ? 'keyResult' : null,
    },
    { value: weights.weight * weightValue, reason: input.weight >= 4 ? 'weight' : null },
  ];
  const score = Math.round(parts.reduce((sum, p) => sum + p.value, 0) * 10) / 10;
  const reasons = parts
    .filter((p): p is { value: number; reason: RankReason } => p.reason !== null && p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((p) => p.reason);
  return { score, reasons };
}

/**
 * A personal order (drag and drop) merged with new items: ordered items keep their order; an item
 * without a place goes before the first ordered item that scores lower. `items` arrive sorted by
 * score, highest first.
 */
export function mergeManualOrder<T extends { id: string; score: number }>(
  items: readonly T[],
  manual: ReadonlyMap<string, string>,
): T[] {
  const ordered = items
    .filter((i) => manual.has(i.id))
    .sort((a, b) => {
      const ka = manual.get(a.id) ?? '';
      const kb = manual.get(b.id) ?? '';
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  const result = [...ordered];
  for (const item of items.filter((i) => !manual.has(i.id))) {
    const at = result.findIndex((r) => manual.has(r.id) && r.score < item.score);
    if (at === -1) result.push(item);
    else result.splice(at, 0, item);
  }
  return result;
}
