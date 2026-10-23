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
  /** No summary yet, but the assistant will still write one (a recent report). */
  pending: z.boolean(),
});
export type ReportSummary = z.infer<typeof reportSummary>;

/** «از مدار بپرس» (plan phase-3-step-16b, ADR 0026). */
export const ASK_QUESTION_MAX = 500;
/** Most sources one answer is written from. */
export const ASK_SOURCES_MAX = 8;

export const KNOWLEDGE_KINDS = ['task', 'letter', 'meeting', 'channel'] as const;
export const knowledgeKind = z.enum(KNOWLEDGE_KINDS);
export type KnowledgeKind = z.infer<typeof knowledgeKind>;

export const askRequest = z.object({
  question: z.string().trim().min(3).max(ASK_QUESTION_MAX),
});
export type AskRequest = z.infer<typeof askRequest>;

export const askSource = z.object({
  /** The number the answer cites as `[n]`. */
  n: z.number().int().min(1),
  kind: knowledgeKind,
  /** Task, letter, meeting or conversation id. */
  id: z.uuid(),
  title: z.string(),
  /** For a channel: the company day of the messages and the first message of that day. */
  day: calendarDate.nullable(),
  messageId: z.uuid().nullable(),
  /** The answer refers to it. */
  cited: z.boolean(),
});
export type AskSource = z.infer<typeof askSource>;

export const askResponse = z.object({
  /** Null when nothing the person may see matches: the model is not asked. */
  answer: z.string().nullable(),
  sources: z.array(askSource).max(ASK_SOURCES_MAX),
});
export type AskResponse = z.infer<typeof askResponse>;

export const knowledgeIndexStatus = z.object({
  /** Indexed sources (not chunks) by kind. */
  sources: z.record(knowledgeKind, z.number().int().min(0)),
  chunks: z.number().int().min(0),
  /** The first full indexing after the assistant was turned on has finished. */
  ready: z.boolean(),
});
export type KnowledgeIndexStatus = z.infer<typeof knowledgeIndexStatus>;
