import { z } from 'zod';

import { calendarDate } from './work.js';

/**
 * The assistant (plan phase-3-step-16a, ADR 0025). Everything runs in our own AI service with an
 * open-source model; the company turns it on (`tenants.settings.ai`) and every output is a draft a
 * person reads or confirms.
 */
export const aiSettings = z.object({ enabled: z.boolean() });
export type AiSettings = z.infer<typeof aiSettings>;
export const DEFAULT_AI_SETTINGS: AiSettings = { enabled: false };

export const aiStatus = z.object({
  /** This server has an AI service configured. */
  available: z.boolean(),
  /** The company turned the assistant on. */
  enabled: z.boolean(),
});
export type AiStatus = z.infer<typeof aiStatus>;

export const TASK_BREAKDOWN_MAX = 10;

export const taskBreakdownRequest = z.object({
  sentence: z.string().trim().min(3).max(300),
  departmentId: z.uuid(),
});
export type TaskBreakdownRequest = z.infer<typeof taskBreakdownRequest>;

export const suggestedTask = z.object({
  title: z.string().min(1).max(200),
  /** A working day, from the model's «in N days». */
  dueOn: calendarDate.nullable(),
});
export type SuggestedTask = z.infer<typeof suggestedTask>;

export const taskBreakdownResponse = z.object({
  tasks: z.array(suggestedTask).max(TASK_BREAKDOWN_MAX),
});
export type TaskBreakdownResponse = z.infer<typeof taskBreakdownResponse>;

/** The assistant's summary of a stored weekly report; null while not made (or when off). */
export const reportSummary = z.object({
  summary: z.object({ text: z.string(), createdAt: z.iso.datetime() }).nullable(),
});
export type ReportSummary = z.infer<typeof reportSummary>;
