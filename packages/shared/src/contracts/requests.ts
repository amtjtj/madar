import { z } from 'zod';

import { attachment } from '../files.js';
import { addDays } from '../locale/jalali.js';
import { workingDaysBetween, type WorkCalendar } from '../locale/work-calendar.js';
import { calendarDate } from './work.js';

/**
 * Requests and approvals (plan phase-3-step-17b, ADR 0028): three kinds with fixed forms, a one or
 * two step approval chain worked out when the request is made, and leaves that follow from an
 * approved leave request.
 */
export const REQUEST_KINDS = ['leave', 'expense', 'general'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'canceled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_DECISIONS = ['approved', 'rejected'] as const;
export type RequestDecision = (typeof REQUEST_DECISIONS)[number];

export const LEAVE_KINDS = ['daily', 'hourly'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export const EXPENSE_CATEGORIES = ['equipment', 'travel', 'training', 'supplies', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const REQUEST_BOXES = ['pending', 'mine', 'decided'] as const;
export type RequestBox = (typeof REQUEST_BOXES)[number];

/** A quarter-hour wall-clock time in the company's time zone. */
export const quarterTime = z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/);

const note = z.string().trim().max(1000).default('');

export const leaveData = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('daily'), startsOn: calendarDate, endsOn: calendarDate, note })
    .refine((d) => d.startsOn <= d.endsOn, { message: 'ends before it starts' }),
  z
    .object({
      kind: z.literal('hourly'),
      on: calendarDate,
      from: quarterTime,
      to: quarterTime,
      note,
    })
    .refine((d) => d.from < d.to, { message: 'ends before it starts' }),
]);
export type LeaveData = z.infer<typeof leaveData>;

/** Amounts are whole tomans in the API and the UI; the database keeps rials. */
export const EXPENSE_MAX_TOMAN = 100_000_000_000;
export const expenseData = z.object({
  amountToman: z.number().int().min(1_000).max(EXPENSE_MAX_TOMAN),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(3).max(2000),
});
export type ExpenseData = z.infer<typeof expenseData>;

export const generalData = z.object({ body: z.string().trim().min(3).max(4000) });
export type GeneralData = z.infer<typeof generalData>;

const uploadIds = z.array(z.uuid()).max(10).default([]);

export const createRequestRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('leave'), data: leaveData }),
  z.object({ kind: z.literal('expense'), data: expenseData, uploadIds }),
  z.object({
    kind: z.literal('general'),
    title: z.string().trim().min(2).max(200),
    data: generalData,
    uploadIds,
  }),
]);
export type CreateRequestRequest = z.infer<typeof createRequestRequest>;

export const decideRequestRequest = z.object({
  decision: z.enum(REQUEST_DECISIONS),
  comment: z.string().trim().max(1000).default(''),
});
export type DecideRequestRequest = z.infer<typeof decideRequestRequest>;

export const listRequestsQuery = z.object({
  box: z.enum(REQUEST_BOXES).default('pending'),
  /** The last id of the previous page (ids are time-ordered). */
  before: z.uuid().optional(),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuery>;

export const REQUESTS_PAGE = 30;

const person = z.object({ id: z.uuid(), displayName: z.string() });

export const requestSummary = z.object({
  id: z.uuid(),
  kind: z.enum(REQUEST_KINDS),
  title: z.string(),
  status: z.enum(REQUEST_STATUSES),
  requester: person,
  department: z.object({ id: z.uuid(), name: z.string() }),
  /** Expense only. */
  amountToman: z.number().int().nullable(),
  /** Whose decision it waits on (pending only). */
  waitingOn: person.nullable(),
  stepCount: z.number().int(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type RequestSummary = z.infer<typeof requestSummary>;

export const requestStep = z.object({
  index: z.number().int(),
  approver: person,
  decision: z.enum(REQUEST_DECISIONS).nullable(),
  comment: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  /** Decided by someone other than the step's approver (the leadership standing in). */
  decidedBy: person.nullable(),
});
export type RequestStep = z.infer<typeof requestStep>;

export const requestDetail = requestSummary.extend({
  data: z.union([leaveData, expenseData, generalData]),
  steps: z.array(requestStep),
  /** Working days a daily leave takes (holidays and days off not counted). */
  leaveDays: z.number().int().nullable(),
  attachments: z.array(attachment),
  can: z.object({ decide: z.boolean(), cancel: z.boolean() }),
});
export type RequestDetail = z.infer<typeof requestDetail>;

export const requestCounts = z.object({ pending: z.number().int() });
export type RequestCounts = z.infer<typeof requestCounts>;

/** Who a new request would go to, shown before submitting. */
export const requestRoute = z.object({ approvers: z.array(person) });
export type RequestRoute = z.infer<typeof requestRoute>;

export const routeQuery = z.object({
  kind: z.enum(REQUEST_KINDS),
  amountToman: z.coerce.number().int().min(0).max(EXPENSE_MAX_TOMAN).optional(),
});
export type RouteQuery = z.infer<typeof routeQuery>;

/** The company's approval settings (in `tenants.settings.approvals`). */
export const DEFAULT_EXPENSE_THRESHOLD_TOMAN = 10_000_000;
export const approvalSettings = z.object({
  expenseThresholdToman: z
    .number()
    .int()
    .min(0)
    .max(EXPENSE_MAX_TOMAN)
    .default(DEFAULT_EXPENSE_THRESHOLD_TOMAN),
});
export type ApprovalSettings = z.infer<typeof approvalSettings>;

export interface ApprovalPeople {
  requesterId: string;
  /** The requester's reporting line, direct manager first (`members.manager_id`). */
  managerChain: readonly string[];
  /** Heads first, then managers, of the requester's primary department. */
  departmentManagers: readonly string[];
  /** The leadership (owners, executives), active only. */
  leaders: readonly string[];
}

/**
 * Who approves, step by step (ADR 0028). Step 1: the direct manager, else the primary department's
 * head or manager, else the leadership. Step 2, for an expense over the threshold only: the
 * leadership, unless step 1 already is. Nobody ever approves their own request. Empty when nobody
 * can (a one-person company), which the API refuses.
 */
export function approvalChain(
  people: ApprovalPeople,
  request: { kind: RequestKind; amountToman: number | null; thresholdToman: number },
): string[] {
  const notMe = (ids: readonly string[]) => ids.filter((id) => id !== people.requesterId);
  const leaders = notMe(people.leaders);
  const first =
    notMe(people.managerChain.slice(0, 1))[0] ?? notMe(people.departmentManagers)[0] ?? leaders[0];
  if (!first) return [];
  const steps = [first];
  const overThreshold =
    request.kind === 'expense' && (request.amountToman ?? 0) > request.thresholdToman;
  if (overThreshold && !leaders.includes(first) && leaders[0]) steps.push(leaders[0]);
  return steps;
}

/** Working days a daily leave takes: holidays and days off do not count (ADR 0028). */
export function leaveWorkingDays(calendar: WorkCalendar, startsOn: string, endsOn: string): number {
  return workingDaysBetween(calendar, addDays(startsOn, -1), endsOn);
}

/** The title a request gets when it has none of its own. */
export function requestTitleKey(kind: RequestKind): `requests.titles.${RequestKind}` {
  return `requests.titles.${kind}`;
}

/** A leave on the calendar (approved leave requests only). */
export const leaveEntry = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  member: person,
  kind: z.enum(LEAVE_KINDS),
  startsOn: calendarDate,
  endsOn: calendarDate,
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
});
export type LeaveEntry = z.infer<typeof leaveEntry>;
