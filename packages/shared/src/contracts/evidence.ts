import { z } from 'zod';

import { attachment } from '../files.js';
import { letterBody, LETTER_URGENCIES } from './letters.js';

/**
 * «شاهد کار» (plan phase-2-step-12b, ADR 0021): a letter (later minutes or a message) pinned to a
 * task. Everyone who sees the task sees that one item read-only, never its thread.
 */
export const EVIDENCE_KINDS = ['letter'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const personRef = z.object({ id: z.uuid(), displayName: z.string() });

/** The read-only card: what a task viewer may learn about the pinned item. */
export const evidenceSummary = z.object({
  subject: z.string(),
  number: z.string().nullable(),
  sender: personRef,
  to: z.array(personRef),
  date: z.iso.datetime(),
  urgency: z.enum(LETTER_URGENCIES),
  /** Every main («to») recipient has opened it; never who did. */
  read: z.boolean(),
  attachmentCount: z.number().int(),
});
export type EvidenceSummary = z.infer<typeof evidenceSummary>;

export const evidence = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  kind: z.enum(EVIDENCE_KINDS),
  subjectId: z.uuid(),
  pinnedBy: personRef,
  pinnedAt: z.iso.datetime(),
  /** Null when the item is no longer available (a source that was removed). */
  summary: evidenceSummary.nullable(),
  can: z.object({ unpin: z.boolean() }),
});
export type Evidence = z.infer<typeof evidence>;

/** The pinned item itself, read-only, for anyone who sees the task. */
export const evidenceDetail = evidence.extend({
  body: letterBody,
  cc: z.array(personRef),
  attachments: z.array(attachment),
});
export type EvidenceDetail = z.infer<typeof evidenceDetail>;

export const pinEvidenceRequest = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  subjectId: z.uuid(),
});
export type PinEvidenceRequest = z.infer<typeof pinEvidenceRequest>;

export const AUDIENCE_ROLES = ['assignee', 'reporter', 'collaborator'] as const;
export const AUDIENCE_GROUPS = [
  /** Members of the task's (private or shared) project. */
  'project_members',
  /** Everyone in the task's department who reads department work. */
  'department',
  /** Oversight departments and owners (company-wide readers). */
  'company_readers',
  /** A company-wide project: every member. */
  'everyone',
] as const;
export type AudienceGroup = (typeof AUDIENCE_GROUPS)[number];

/** «چه کسانی خواهند دید»: shown before pinning. */
export const evidenceAudience = z.object({
  people: z.array(personRef.extend({ role: z.enum(AUDIENCE_ROLES) })),
  groups: z.array(z.object({ kind: z.enum(AUDIENCE_GROUPS), name: z.string().nullable() })),
});
export type EvidenceAudience = z.infer<typeof evidenceAudience>;

export const evidenceCandidatesQuery = z.object({ q: z.string().trim().max(80).optional() });
export type EvidenceCandidatesQuery = z.infer<typeof evidenceCandidatesQuery>;

/** A task a letter is pinned to, as the letter page lists it. */
export const pinnedTask = z.object({ evidenceId: z.uuid(), taskId: z.uuid(), title: z.string() });
export type PinnedTask = z.infer<typeof pinnedTask>;
