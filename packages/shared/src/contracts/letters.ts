import { z } from 'zod';

import { attachment } from '../files.js';
import { LITE_TEXT_MAX } from '../letter-text.js';

/** Internal letters (plan phase-2-step-12a, ADR 0020). */
export const LETTER_URGENCIES = ['normal', 'urgent', 'immediate'] as const;
export type LetterUrgency = (typeof LETTER_URGENCIES)[number];
export const LETTER_FOLDERS = ['inbox', 'sent', 'drafts', 'archive'] as const;
export type LetterFolder = (typeof LETTER_FOLDERS)[number];
export const RECIPIENT_KINDS = ['to', 'cc', 'referral'] as const;
export type RecipientKind = (typeof RECIPIENT_KINDS)[number];

const personRef = z.object({ id: z.uuid(), displayName: z.string() });

/** «1405/00042»: Jalali year and a gap-free sequence per company and year. */
export function formatLetterNumber(jalaliYear: number, sequence: number): string {
  return `${jalaliYear}/${String(sequence).padStart(5, '0')}`;
}

export const letterBody = z.object({
  format: z.literal('lite'),
  text: z.string().max(LITE_TEXT_MAX),
});
export type LetterBody = z.infer<typeof letterBody>;

export const letterSummary = z.object({
  id: z.uuid(),
  number: z.string().nullable(),
  subject: z.string(),
  preview: z.string(),
  sender: personRef,
  /** The first recipients, for the «sent» folder. */
  to: z.array(personRef),
  urgency: z.enum(LETTER_URGENCIES),
  confidential: z.boolean(),
  sentAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  attachmentCount: z.number().int(),
  /** How the viewer got it (null for the sender). */
  receivedAs: z.enum(RECIPIENT_KINDS).nullable(),
  read: z.boolean(),
});
export type LetterSummary = z.infer<typeof letterSummary>;

export const letterRecipient = personRef.extend({
  kind: z.enum(RECIPIENT_KINDS),
  /** Only the sender and the person who referred see when others read it. */
  readAt: z.iso.datetime().nullable().optional(),
  referredBy: personRef.nullable(),
  referralNote: z.string().nullable(),
  referredAt: z.iso.datetime().nullable(),
});
export type LetterRecipient = z.infer<typeof letterRecipient>;

export const letter = letterSummary.extend({
  body: letterBody,
  recipients: z.array(letterRecipient),
  attachments: z.array(attachment),
  threadId: z.uuid(),
  replyToId: z.uuid().nullable(),
  /** Other letters of the thread the viewer may open, oldest first. */
  thread: z.array(letterSummary),
  archived: z.boolean(),
  can: z.object({ edit: z.boolean(), refer: z.boolean(), reply: z.boolean() }),
});
export type Letter = z.infer<typeof letter>;

export const letterList = z.object({
  items: z.array(letterSummary),
  /** Pass as `before` for the next page; null on the last page. */
  nextBefore: z.iso.datetime().nullable(),
});
export type LetterList = z.infer<typeof letterList>;

export const letterUnreadCount = z.object({ count: z.number().int() });
export type LetterUnreadCount = z.infer<typeof letterUnreadCount>;

const memberIds = z.array(z.uuid()).max(50);

export const saveLetterRequest = z.object({
  subject: z.string().trim().max(200),
  body: letterBody,
  to: memberIds,
  cc: memberIds.default([]),
  urgency: z.enum(LETTER_URGENCIES).default('normal'),
  confidential: z.boolean().default(false),
  uploadIds: z.array(z.uuid()).max(10).default([]),
  replyToId: z.uuid().nullable().optional(),
});
export type SaveLetterRequest = z.infer<typeof saveLetterRequest>;

export const referLetterRequest = z.object({
  memberIds: z.array(z.uuid()).min(1).max(20),
  note: z.string().trim().max(500).default(''),
});
export type ReferLetterRequest = z.infer<typeof referLetterRequest>;

export const listLettersQuery = z.object({
  folder: z.enum(LETTER_FOLDERS).default('inbox'),
  q: z.string().trim().max(80).optional(),
  /** ISO time of the last row of the previous page. */
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListLettersQuery = z.infer<typeof listLettersQuery>;
