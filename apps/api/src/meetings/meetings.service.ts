import { HttpStatus, Injectable } from '@nestjs/common';
import { emitEvent, schema as s, uuidv7, type Tx } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  MINUTES_FILES_MAX,
  meetingTimeError,
  safeMeetingLink,
  zonedInstant,
  type ConvertDecisionRequest,
  type CreateMeetingRequest,
  type DecisionRequest,
  type ListMeetingsQuery,
  type Meeting,
  type MeetingDecision,
  type MeetingList,
  type MeetingSummary,
  type SaveMinutesRequest,
  type Task,
  type UpdateMeetingRequest,
} from '@madar/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { attachmentRows, bindUploads, toAttachment } from '../files/attachments-db.js';
import { keyResultRefs } from '../goals/links.js';
import { canCreateIn, visibleTasks } from '../work/access.js';
import { TasksService } from '../work/tasks.service.js';
import { takesPart, visibleMeetings } from './access.js';

type MeetingRow = typeof s.meetings.$inferSelect;

const canceled = () =>
  new ApiError(HttpStatus.CONFLICT, 'meeting_canceled', 'A canceled meeting does not change');
const needsOne = () =>
  new ApiError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'one_on_one_needs_one',
    'A one-on-one has exactly one other person',
  );
const badTime = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'meeting_time_invalid', 'End after start, within a day');
const badLink = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'meeting_link_invalid', 'Links are http or https');
const hasTask = () =>
  new ApiError(HttpStatus.CONFLICT, 'decision_has_task', 'The decision already has a task');

const organizer = alias(s.members, 'organizer');
const assignee = alias(s.members, 'decision_assignee');
const recorder = alias(s.members, 'minutes_recorder');
const updater = alias(s.members, 'minutes_updater');

/** An empty link is no link; anything else must be http(s). */
function linkOf(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const link = safeMeetingLink(value);
  if (!link) throw badLink();
  return link;
}

/**
 * Meetings, minutes and decisions (plan phase-2-step-13a, ADR 0023). Who sees a meeting is
 * `visibleMeetings()`; the organizer edits it; the people taking part write the minutes and turn
 * decisions into tasks (source «meeting»).
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly db: TenantDb,
    private readonly tasks: TasksService,
  ) {}

  /** Upcoming (under way or to come) nearest first, or past newest first; both in pages. */
  list(ctx: TenantContext, query: ListMeetingsQuery): Promise<MeetingList> {
    return this.db.run(ctx, async (tx) => {
      const now = new Date();
      const upcoming = query.range === 'upcoming';
      const cursor = query.cursor
        ? {
            at: query.cursor.slice(0, query.cursor.lastIndexOf('_')),
            id: query.cursor.slice(query.cursor.lastIndexOf('_') + 1),
          }
        : null;
      const key = sql`(${s.meetings.startsAt}, ${s.meetings.id})`;
      const after = cursor ? sql`(${cursor.at}::timestamptz, ${cursor.id}::uuid)` : null;
      const rows = await this.summaryQuery(tx)
        .where(
          and(
            visibleMeetings(ctx.actor),
            upcoming ? gt(s.meetings.endsAt, now) : lte(s.meetings.endsAt, now),
            after ? (upcoming ? sql`${key} > ${after}` : sql`${key} < ${after}`) : undefined,
          ),
        )
        .orderBy(
          ...(upcoming
            ? [asc(s.meetings.startsAt), asc(s.meetings.id)]
            : [desc(s.meetings.startsAt), desc(s.meetings.id)]),
        )
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toSummary),
        next: rows.length > query.limit && last ? `${last.cursorAt}_${last.meeting.id}` : null,
      };
    });
  }

  /** Today's meetings the person takes part in (not those seen through oversight). */
  today(ctx: TenantContext): Promise<MeetingSummary[]> {
    return this.db.run(ctx, async (tx) => {
      const timeZone = await this.timeZone(tx, ctx);
      const today = calendarDateIn(new Date(), timeZone);
      const rows = await this.summaryQuery(tx)
        .where(
          and(
            takesPart(ctx.memberId),
            isNull(s.meetings.canceledAt),
            sql`${s.meetings.startsAt} >= ${zonedInstant(today, '00:00', timeZone)}`,
            sql`${s.meetings.startsAt} < ${zonedInstant(addDays(today, 1), '00:00', timeZone)}`,
          ),
        )
        .orderBy(asc(s.meetings.startsAt), asc(s.meetings.id));
      return rows.map(toSummary);
    });
  }

  get(ctx: TenantContext, id: string): Promise<Meeting> {
    return this.db.run(ctx, async (tx) =>
      this.detail(tx, ctx, await this.requireVisible(tx, ctx, id)),
    );
  }

  create(ctx: TenantContext, body: CreateMeetingRequest): Promise<Meeting> {
    return this.db.run(ctx, async (tx) => {
      const startsAt = new Date(body.startsAt);
      const endsAt = new Date(body.endsAt);
      if (meetingTimeError(startsAt, endsAt)) throw badTime();
      const link = linkOf(body.link);
      const others = [...new Set(body.participantIds)].filter((m) => m !== ctx.memberId);
      if (body.type === 'one_on_one' && others.length !== 1) throw needsOne();
      await this.requireActive(tx, others);
      const departmentId = await this.tasks.primaryDepartment(tx, ctx);
      if (!departmentId) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'no_department', 'Join a department first');
      }
      const id = uuidv7();
      const [meeting] = await tx
        .insert(s.meetings)
        .values({
          id,
          type: body.type,
          title: body.title,
          startsAt,
          endsAt,
          location: body.location?.trim() || null,
          link,
          agenda: body.agenda ?? '',
          organizerId: ctx.memberId,
          departmentId,
        })
        .returning();
      if (!meeting) throw notFound('Meeting');
      await tx
        .insert(s.meetingParticipants)
        .values([ctx.memberId, ...others].map((memberId) => ({ meetingId: id, memberId })));
      await emitEvent(tx, 'meeting.scheduled', { meetingId: id, memberIds: others }, ctx.memberId);
      return this.detail(tx, ctx, meeting);
    });
  }

  /** The organizer changes time, place, agenda and people; people are removed only before it starts. */
  update(ctx: TenantContext, id: string, body: UpdateMeetingRequest): Promise<Meeting> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.requireVisible(tx, ctx, id, true);
      if (current.organizerId !== ctx.memberId) throw forbidden();
      if (current.canceledAt) throw canceled();
      const startsAt = body.startsAt ? new Date(body.startsAt) : current.startsAt;
      const endsAt = body.endsAt ? new Date(body.endsAt) : current.endsAt;
      if (meetingTimeError(startsAt, endsAt)) throw badTime();
      const link = body.link === undefined ? current.link : linkOf(body.link);
      const location =
        body.location === undefined ? current.location : body.location?.trim() || null;

      let added: string[] = [];
      let removed: string[] = [];
      if (body.participantIds) {
        const before = (await this.participantIds(tx, id)).filter((m) => m !== current.organizerId);
        const after = [...new Set(body.participantIds)].filter((m) => m !== current.organizerId);
        if (current.type === 'one_on_one' && after.length !== 1) throw needsOne();
        added = after.filter((m) => !before.includes(m));
        removed = before.filter((m) => !after.includes(m));
        if (removed.length && current.startsAt <= new Date()) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'meeting_started',
            'People leave a meeting only before it starts',
          );
        }
        await this.requireActive(tx, added);
        if (removed.length) {
          await tx
            .delete(s.meetingParticipants)
            .where(
              and(
                eq(s.meetingParticipants.meetingId, id),
                inArray(s.meetingParticipants.memberId, removed),
              ),
            );
        }
        if (added.length) {
          await tx
            .insert(s.meetingParticipants)
            .values(added.map((memberId) => ({ meetingId: id, memberId })));
        }
      }

      const [meeting] = await tx
        .update(s.meetings)
        .set({
          title: body.title ?? current.title,
          startsAt,
          endsAt,
          location,
          link,
          agenda: body.agenda ?? current.agenda,
          updatedAt: new Date(),
        })
        .where(eq(s.meetings.id, id))
        .returning();
      if (!meeting) throw notFound('Meeting');
      const moved =
        startsAt.getTime() !== current.startsAt.getTime() ||
        endsAt.getTime() !== current.endsAt.getTime() ||
        location !== current.location ||
        link !== current.link;
      await emitEvent(
        tx,
        'meeting.updated',
        { meetingId: id, notify: moved, removedIds: removed },
        ctx.memberId,
      );
      if (added.length) {
        await emitEvent(tx, 'meeting.scheduled', { meetingId: id, memberIds: added }, ctx.memberId);
      }
      return this.detail(tx, ctx, meeting);
    });
  }

  /** Soft: the meeting, its minutes and decisions stay, read-only. */
  cancel(ctx: TenantContext, id: string): Promise<Meeting> {
    return this.db.run(ctx, async (tx) => {
      const current = await this.requireVisible(tx, ctx, id, true);
      if (current.organizerId !== ctx.memberId) throw forbidden();
      if (current.canceledAt) throw canceled();
      const [meeting] = await tx
        .update(s.meetings)
        .set({ canceledAt: new Date(), updatedAt: new Date() })
        .where(eq(s.meetings.id, id))
        .returning();
      if (!meeting) throw notFound('Meeting');
      await emitEvent(tx, 'meeting.canceled', { meetingId: id }, ctx.memberId);
      return this.detail(tx, ctx, meeting);
    });
  }

  /**
   * One shared text per meeting: a save based on an older version is refused, so two writers never
   * overwrite each other. Only the first save notifies the participants.
   */
  saveMinutes(ctx: TenantContext, id: string, body: SaveMinutesRequest): Promise<Meeting> {
    return this.db.run(ctx, async (tx) => {
      const meeting = await this.requireWritable(tx, ctx, id);
      const [existing] = await tx
        .select()
        .from(s.meetingMinutes)
        .where(eq(s.meetingMinutes.meetingId, id))
        .for('update');
      const conflict = () =>
        new ApiError(HttpStatus.CONFLICT, 'minutes_version_conflict', 'The minutes changed');
      let minutesId: string;
      if (!existing) {
        if (body.version !== 0) throw conflict();
        const [row] = await tx
          .insert(s.meetingMinutes)
          .values({
            meetingId: id,
            body: body.body,
            recordedBy: ctx.memberId,
            updatedBy: ctx.memberId,
          })
          .onConflictDoNothing()
          .returning({ id: s.meetingMinutes.id });
        // Someone else saved the first version in the meantime.
        if (!row) throw conflict();
        minutesId = row.id;
      } else {
        if (body.version !== existing.version) throw conflict();
        minutesId = existing.id;
        await tx
          .update(s.meetingMinutes)
          .set({
            body: body.body,
            updatedBy: ctx.memberId,
            updatedAt: new Date(),
            version: existing.version + 1,
          })
          .where(eq(s.meetingMinutes.id, existing.id));
      }
      const uploadIds = body.uploadIds ?? [];
      if (uploadIds.length) {
        const files = await attachmentRows(
          tx,
          and(eq(s.attachments.subjectType, 'minutes'), eq(s.attachments.subjectId, minutesId)),
        );
        if (files.length + new Set(uploadIds).size > MINUTES_FILES_MAX) {
          throw new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'Too many files');
        }
        await bindUploads(tx, ctx, uploadIds, { type: 'minutes', id: minutesId });
      }
      await emitEvent(
        tx,
        'meeting.minutes_recorded',
        { meetingId: id, first: !existing },
        ctx.memberId,
      );
      return this.detail(tx, ctx, meeting);
    });
  }

  addDecision(ctx: TenantContext, id: string, body: DecisionRequest): Promise<Meeting> {
    return this.db.run(ctx, async (tx) => {
      const meeting = await this.requireWritable(tx, ctx, id);
      await tx
        .insert(s.meetingDecisions)
        .values({ meetingId: id, text: body.text, createdBy: ctx.memberId });
      await this.changed(tx, ctx, id);
      return this.detail(tx, ctx, meeting);
    });
  }

  /** Only while it has no task: the task is the record from then on. */
  updateDecision(
    ctx: TenantContext,
    id: string,
    decisionId: string,
    body: DecisionRequest,
  ): Promise<Meeting> {
    return this.db.run(ctx, async (tx) => {
      const meeting = await this.requireWritable(tx, ctx, id);
      const decision = await this.requireDecision(tx, id, decisionId);
      if (decision.taskId) throw hasTask();
      await tx
        .update(s.meetingDecisions)
        .set({ text: body.text })
        .where(eq(s.meetingDecisions.id, decisionId));
      await this.changed(tx, ctx, id);
      return this.detail(tx, ctx, meeting);
    });
  }

  removeDecision(ctx: TenantContext, id: string, decisionId: string): Promise<Meeting> {
    return this.db.run(ctx, async (tx) => {
      const meeting = await this.requireWritable(tx, ctx, id);
      const decision = await this.requireDecision(tx, id, decisionId);
      if (decision.taskId) throw hasTask();
      await tx.delete(s.meetingDecisions).where(eq(s.meetingDecisions.id, decisionId));
      await this.changed(tx, ctx, id);
      return this.detail(tx, ctx, meeting);
    });
  }

  /**
   * A decision becomes one task in the meeting's department, with source «meeting» (ADR 0017),
   * and in an OKR review optionally a key result. The task keeps its own access rules.
   */
  convertDecision(
    ctx: TenantContext,
    id: string,
    decisionId: string,
    body: ConvertDecisionRequest,
  ): Promise<Task> {
    return this.db.run(ctx, async (tx) => {
      const meeting = await this.requireWritable(tx, ctx, id);
      const decision = await this.requireDecision(tx, id, decisionId, true);
      if (decision.taskId) throw hasTask();
      const keyResultId = body.keyResultId ?? null;
      if (keyResultId && meeting.type !== 'okr_review') {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'validation_failed', 'OKR reviews only');
      }
      const task = await this.tasks.createIn(
        tx,
        ctx,
        {
          title: body.title,
          departmentId: meeting.departmentId,
          assigneeId: body.assigneeId ?? null,
          dueOn: body.dueOn ?? null,
        },
        { meeting: true, keyResultId },
      );
      await tx
        .update(s.meetingDecisions)
        .set({ taskId: task.id, keyResultId })
        .where(eq(s.meetingDecisions.id, decisionId));
      await emitEvent(
        tx,
        'meeting.decision_converted',
        { meetingId: id, decisionId, taskId: task.id },
        ctx.memberId,
      );
      return {
        ...task,
        meeting: { id: meeting.id, title: meeting.title, visible: true },
      };
    });
  }

  private summaryQuery(tx: Tx) {
    return tx
      .select({
        meeting: s.meetings,
        organizerName: organizer.displayName,
        participantCount: sql<number>`(select count(*)::int from meeting_participants mp where mp.meeting_id = ${s.meetings.id})`,
        hasMinutes: sql<boolean>`exists (select 1 from meeting_minutes mm where mm.meeting_id = ${s.meetings.id})`,
        cursorAt: sql<string>`to_char(${s.meetings.startsAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(s.meetings)
      .innerJoin(organizer, eq(organizer.id, s.meetings.organizerId))
      .$dynamic();
  }

  private async requireVisible(
    tx: Tx,
    ctx: TenantContext,
    id: string,
    lock = false,
  ): Promise<MeetingRow> {
    const query = tx
      .select()
      .from(s.meetings)
      .where(and(eq(s.meetings.id, id), visibleMeetings(ctx.actor)));
    const [meeting] = lock ? await query.for('update') : await query;
    if (!meeting) throw notFound('Meeting');
    return meeting;
  }

  /** Someone taking part, on a meeting that is not canceled. */
  private async requireWritable(tx: Tx, ctx: TenantContext, id: string): Promise<MeetingRow> {
    const meeting = await this.requireVisible(tx, ctx, id, true);
    if (!(await this.participantIds(tx, id)).includes(ctx.memberId)) throw forbidden();
    if (meeting.canceledAt) throw canceled();
    return meeting;
  }

  private async requireDecision(tx: Tx, meetingId: string, decisionId: string, lock = false) {
    const query = tx
      .select()
      .from(s.meetingDecisions)
      .where(
        and(eq(s.meetingDecisions.id, decisionId), eq(s.meetingDecisions.meetingId, meetingId)),
      );
    const [decision] = lock ? await query.for('update') : await query;
    if (!decision) throw notFound('Decision');
    return decision;
  }

  private async requireActive(tx: Tx, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await tx
      .select({ id: s.members.id })
      .from(s.members)
      .where(and(inArray(s.members.id, ids), eq(s.members.status, 'active')));
    if (rows.length !== ids.length) throw notFound('Member');
  }

  private async participantIds(tx: Tx, meetingId: string): Promise<string[]> {
    const rows = await tx
      .select({ memberId: s.meetingParticipants.memberId })
      .from(s.meetingParticipants)
      .where(eq(s.meetingParticipants.meetingId, meetingId));
    return rows.map((r) => r.memberId);
  }

  /** A change that needs no notification, only a live refresh. */
  private changed(tx: Tx, ctx: TenantContext, meetingId: string) {
    return emitEvent(
      tx,
      'meeting.updated',
      { meetingId, notify: false, removedIds: [] },
      ctx.memberId,
    );
  }

  private async timeZone(tx: Tx, ctx: TenantContext): Promise<string> {
    const [tenant] = await tx
      .select({ timezone: s.tenants.timezone })
      .from(s.tenants)
      .where(eq(s.tenants.id, ctx.tenantId));
    return tenant?.timezone ?? 'Asia/Tehran';
  }

  private async detail(tx: Tx, ctx: TenantContext, meeting: MeetingRow): Promise<Meeting> {
    const [summary] = await this.summaryQuery(tx).where(eq(s.meetings.id, meeting.id));
    if (!summary) throw notFound('Meeting');
    const [department] = await tx
      .select({ id: s.departments.id, name: s.departments.name })
      .from(s.departments)
      .where(eq(s.departments.id, meeting.departmentId));
    const participants = await tx
      .select({ id: s.members.id, displayName: s.members.displayName })
      .from(s.meetingParticipants)
      .innerJoin(s.members, eq(s.members.id, s.meetingParticipants.memberId))
      .where(eq(s.meetingParticipants.meetingId, meeting.id))
      .orderBy(asc(s.meetingParticipants.addedAt), asc(s.members.displayName));
    // The organizer first.
    participants.sort((a, b) =>
      a.id === meeting.organizerId ? -1 : b.id === meeting.organizerId ? 1 : 0,
    );
    const writes = participants.some((p) => p.id === ctx.memberId);
    const open = writes && !meeting.canceledAt;

    const [minutesRow] = await tx
      .select({
        minutes: s.meetingMinutes,
        recordedByName: recorder.displayName,
        updatedByName: updater.displayName,
      })
      .from(s.meetingMinutes)
      .innerJoin(recorder, eq(recorder.id, s.meetingMinutes.recordedBy))
      .innerJoin(updater, eq(updater.id, s.meetingMinutes.updatedBy))
      .where(eq(s.meetingMinutes.meetingId, meeting.id));
    const files = minutesRow
      ? await attachmentRows(
          tx,
          and(
            eq(s.attachments.subjectType, 'minutes'),
            eq(s.attachments.subjectId, minutesRow.minutes.id),
          ),
        )
      : [];

    const decisionRows = await tx
      .select({
        decision: s.meetingDecisions,
        taskTitle: s.tasks.title,
        assigneeId: assignee.id,
        assigneeName: assignee.displayName,
        visible: sql<boolean>`coalesce(${s.tasks.deletedAt} is null and ${visibleTasks(ctx.actor)}, false)`,
      })
      .from(s.meetingDecisions)
      .leftJoin(s.tasks, eq(s.tasks.id, s.meetingDecisions.taskId))
      .leftJoin(assignee, eq(assignee.id, s.tasks.assigneeId))
      .where(eq(s.meetingDecisions.meetingId, meeting.id))
      .orderBy(asc(s.meetingDecisions.createdAt), asc(s.meetingDecisions.id));
    const keyResults = await keyResultRefs(
      tx,
      ctx.actor,
      decisionRows.map((r) => r.decision.keyResultId),
    );
    const decisions: MeetingDecision[] = decisionRows.map((r) => {
      const kr = r.decision.keyResultId ? keyResults.get(r.decision.keyResultId) : undefined;
      return {
        id: r.decision.id,
        text: r.decision.text,
        createdAt: r.decision.createdAt.toISOString(),
        keyResult: kr ? { id: kr.id, title: kr.title } : null,
        task: r.decision.taskId
          ? {
              id: r.decision.taskId,
              visible: r.visible,
              title: r.visible ? (r.taskTitle ?? null) : null,
              assignee:
                r.visible && r.assigneeId && r.assigneeName
                  ? { id: r.assigneeId, displayName: r.assigneeName }
                  : null,
            }
          : null,
      };
    });

    return {
      ...toSummary(summary),
      agenda: meeting.agenda,
      department: department ?? { id: meeting.departmentId, name: '' },
      participants,
      minutes: minutesRow
        ? {
            body: minutesRow.minutes.body,
            version: minutesRow.minutes.version,
            recordedBy: {
              id: minutesRow.minutes.recordedBy,
              displayName: minutesRow.recordedByName,
            },
            recordedAt: minutesRow.minutes.recordedAt.toISOString(),
            updatedBy: { id: minutesRow.minutes.updatedBy, displayName: minutesRow.updatedByName },
            updatedAt: minutesRow.minutes.updatedAt.toISOString(),
            attachments: files.map(({ row, uploaderName }) =>
              toAttachment(row, uploaderName, open),
            ),
          }
        : null,
      decisions,
      can: {
        edit: meeting.organizerId === ctx.memberId && !meeting.canceledAt,
        record: open,
        convert: open && canCreateIn(ctx.actor, meeting.departmentId),
      },
    };
  }
}

function toSummary(r: {
  meeting: MeetingRow;
  organizerName: string;
  participantCount: number;
  hasMinutes: boolean;
}): MeetingSummary {
  const m = r.meeting;
  return {
    id: m.id,
    type: m.type,
    title: m.title,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt.toISOString(),
    location: m.location,
    link: m.link,
    organizer: { id: m.organizerId, displayName: r.organizerName },
    participantCount: r.participantCount,
    hasMinutes: r.hasMinutes,
    canceledAt: m.canceledAt?.toISOString() ?? null,
  };
}
