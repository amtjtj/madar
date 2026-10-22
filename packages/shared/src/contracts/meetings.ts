import { z } from 'zod';

import { attachment } from '../files.js';
import { LITE_TEXT_MAX } from '../letter-text.js';
import {
  DECISION_TEXT_MAX,
  MEETING_AGENDA_MAX,
  MEETING_PARTICIPANTS_MAX,
  MEETING_TITLE_MAX,
  MEETING_TYPES,
  MINUTES_FILES_MAX,
} from '../meetings.js';
import { calendarDate } from './work.js';

/** Meetings, minutes and decisions (plan phase-2-step-13a, ADR 0023). */
const personRef = z.object({ id: z.uuid(), displayName: z.string() });

export const MEETING_RANGES = ['upcoming', 'past'] as const;
export type MeetingRange = (typeof MEETING_RANGES)[number];

export const meetingSummary = z.object({
  id: z.uuid(),
  type: z.enum(MEETING_TYPES),
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  location: z.string().nullable(),
  link: z.string().nullable(),
  organizer: personRef,
  participantCount: z.number().int(),
  hasMinutes: z.boolean(),
  canceledAt: z.iso.datetime().nullable(),
});
export type MeetingSummary = z.infer<typeof meetingSummary>;

export const meetingDecision = z.object({
  id: z.uuid(),
  text: z.string(),
  createdAt: z.iso.datetime(),
  keyResult: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  /** The task made from it; title and assignee only when the viewer may see that task. */
  task: z
    .object({
      id: z.uuid(),
      visible: z.boolean(),
      title: z.string().nullable(),
      assignee: personRef.nullable(),
    })
    .nullable(),
});
export type MeetingDecision = z.infer<typeof meetingDecision>;

export const meetingMinutes = z.object({
  body: z.string(),
  /** Pass back when saving; a stale one returns minutes_version_conflict. */
  version: z.number().int(),
  recordedBy: personRef,
  recordedAt: z.iso.datetime(),
  updatedBy: personRef,
  updatedAt: z.iso.datetime(),
  attachments: z.array(attachment),
});
export type MeetingMinutes = z.infer<typeof meetingMinutes>;

export const meeting = meetingSummary.extend({
  agenda: z.string(),
  department: z.object({ id: z.uuid(), name: z.string() }),
  participants: z.array(personRef),
  minutes: meetingMinutes.nullable(),
  decisions: z.array(meetingDecision),
  can: z.object({ edit: z.boolean(), record: z.boolean(), convert: z.boolean() }),
});
export type Meeting = z.infer<typeof meeting>;

export const meetingList = z.object({
  items: z.array(meetingSummary),
  /** Pass as `before` for the next page of past meetings; null on the last page. */
  nextBefore: z.string().nullable(),
});
export type MeetingList = z.infer<typeof meetingList>;

export const listMeetingsQuery = z.object({
  range: z.enum(MEETING_RANGES).default('upcoming'),
  /** `nextBefore` of the previous page: the last row's start (UTC, microseconds) and id. */
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z_[0-9a-f-]{36}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuery>;

const title = z.string().trim().min(1).max(MEETING_TITLE_MAX);
const location = z.string().trim().max(200).nullable();
const link = z.string().trim().max(500).nullable();
const agenda = z.string().max(MEETING_AGENDA_MAX);
const participantIds = z.array(z.uuid()).max(MEETING_PARTICIPANTS_MAX);

export const createMeetingRequest = z.object({
  type: z.enum(MEETING_TYPES),
  title,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  location: location.optional(),
  link: link.optional(),
  agenda: agenda.default(''),
  /** The other people; the organizer always takes part. */
  participantIds,
});
export type CreateMeetingRequest = z.input<typeof createMeetingRequest>;

export const updateMeetingRequest = z.object({
  title: title.optional(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  location: location.optional(),
  link: link.optional(),
  agenda: agenda.optional(),
  participantIds: participantIds.optional(),
});
export type UpdateMeetingRequest = z.infer<typeof updateMeetingRequest>;

export const saveMinutesRequest = z.object({
  body: z.string().max(LITE_TEXT_MAX),
  /** The version the writer started from; 0 when there were no minutes yet. */
  version: z.number().int().min(0),
  /** New files; a file is removed with the attachment delete endpoint. */
  uploadIds: z.array(z.uuid()).max(MINUTES_FILES_MAX).default([]),
});
export type SaveMinutesRequest = z.input<typeof saveMinutesRequest>;

export const decisionRequest = z.object({
  text: z.string().trim().min(1).max(DECISION_TEXT_MAX),
});
export type DecisionRequest = z.infer<typeof decisionRequest>;

export const convertDecisionRequest = z.object({
  title: z.string().trim().min(1).max(200),
  assigneeId: z.uuid().nullable().optional(),
  dueOn: calendarDate.nullable().optional(),
  /** OKR reviews only: the key result the task serves. */
  keyResultId: z.uuid().nullable().optional(),
});
export type ConvertDecisionRequest = z.infer<typeof convertDecisionRequest>;
