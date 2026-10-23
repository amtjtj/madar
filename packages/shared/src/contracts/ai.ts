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

/** Earlier turns of the same «از مدار بپرس» page: context for a follow-up, never stored (16c). */
export const ASK_HISTORY_MAX = 3;
export const askTurn = z.object({
  question: z.string().trim().min(1).max(ASK_QUESTION_MAX),
  answer: z.string().trim().min(1).max(1500),
});
export type AskTurn = z.infer<typeof askTurn>;

export const askRequest = z.object({
  question: z.string().trim().min(3).max(ASK_QUESTION_MAX),
  history: z.array(askTurn).max(ASK_HISTORY_MAX).optional(),
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
  /** Sources still waiting to be (re)indexed; 0 once the index has caught up. */
  pending: z.number().int().min(0),
});
export type KnowledgeIndexStatus = z.infer<typeof knowledgeIndexStatus>;

/** «مرتب کن با دستیار» (plan phase-3-step-16c): the minute-taker's own notes, tidied. */
export const MINUTES_NOTES_MAX = 8000;
export const MINUTES_DECISIONS_MAX = 6;
export const minutesDraftRequest = z.object({
  meetingId: z.uuid(),
  notes: z.string().trim().min(3).max(MINUTES_NOTES_MAX),
});
export type MinutesDraftRequest = z.infer<typeof minutesDraftRequest>;
export const minutesDraftResponse = z.object({
  /** Lite text («- » items), for the person to edit and save. */
  text: z.string(),
  /** Suggested decisions; each is added only when the person ticks it. */
  decisions: z.array(z.string().max(200)).max(MINUTES_DECISIONS_MAX),
});
export type MinutesDraftResponse = z.infer<typeof minutesDraftResponse>;

/** «پیش‌نویس پاسخ با دستیار»: a reply to a letter I received, from one line of intent. */
export const letterReplyDraftRequest = z.object({
  letterId: z.uuid(),
  intent: z.string().trim().max(300).default(''),
});
export type LetterReplyDraftRequest = z.infer<typeof letterReplyDraftRequest>;
export const letterReplyDraftResponse = z.object({ text: z.string() });
export type LetterReplyDraftResponse = z.infer<typeof letterReplyDraftResponse>;
