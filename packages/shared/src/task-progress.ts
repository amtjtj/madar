import type { StatusCategory } from './contracts/work.js';

/** Progress is recorded in steps of 5, from 0 to 100 (ADR 0018). */
export const PROGRESS_STEP = 5;
export const TASK_PROGRESS_MODES = ['auto', 'manual'] as const;
export type TaskProgressMode = (typeof TASK_PROGRESS_MODES)[number];

/** What people see: a finished task is always 100 %, whatever was last recorded. */
export function displayProgress(statusCategory: StatusCategory, progress: number): number {
  return statusCategory === 'done' ? 100 : progress;
}

export interface ProgressItem {
  statusCategory: StatusCategory;
  progress: number;
  weight: number;
}

/**
 * Weighted average of what people see, canceled work left out; null when nothing counts.
 * Used for a parent task from its subtasks, and for a project from its top-level tasks.
 */
export function weightedProgress(items: readonly ProgressItem[]): number | null {
  let sum = 0;
  let weights = 0;
  for (const item of items) {
    if (item.statusCategory === 'canceled') continue;
    sum += displayProgress(item.statusCategory, item.progress) * item.weight;
    weights += item.weight;
  }
  return weights === 0 ? null : sum / weights;
}

/** A stored value: rounded to the nearest step. */
export function toProgressStep(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value / PROGRESS_STEP) * PROGRESS_STEP));
}
