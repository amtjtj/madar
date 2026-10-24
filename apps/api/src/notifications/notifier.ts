import { Injectable } from '@nestjs/common';
import { emitEvent, schema as s, type Tx } from '@madar/db';
import {
  deliverAfter,
  type NotificationKind,
  type NotificationSubject,
  type WorkCalendar,
} from '@madar/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { loadMemberInTx } from '../auth/tenant-context.service.js';
import { visibleConversations } from '../chat/access.js';
import { visibleGoals } from '../goals/access.js';
import { visibleLetters } from '../letters/access.js';
import { visibleMeetings } from '../meetings/access.js';
import { visibleKudos } from '../gamification/access.js';
import { visibleRequests } from '../requests/access.js';
import { readsReport, visibleProjects, visibleTasks } from '../work/access.js';
import { loadWorkCalendar } from './calendar.js';

export interface NewNotification {
  tenantId: string;
  recipientId: string;
  kind: NotificationKind;
  subjectType: NotificationSubject;
  subjectId: string;
  actorId: string | null;
  /** Shown in the list: the title at the time plus message values. */
  payload: { title: string; data?: Record<string, string | number> };
  dedupeKey: string;
  now?: Date;
  /** Not worth sending once quiet hours would hold it past this time (a meeting reminder). */
  notAfter?: Date;
  /** Already loaded by batch callers (reminders); loaded here otherwise. */
  calendar?: { calendar: WorkCalendar; timeZone: string };
}

/**
 * Creates notifications inside a tenant transaction: never for the actor themself, only for active
 * members who can see the subject, respecting muted kinds and quiet hours (deliver_after).
 */
@Injectable()
export class Notifier {
  async notify(tx: Tx, input: NewNotification): Promise<boolean> {
    if (input.recipientId === input.actorId) return false;
    const recipient = await loadMemberInTx(tx, eq(s.members.id, input.recipientId));
    if (!recipient || recipient.status !== 'active') return false;
    if (!(await this.canSee(tx, recipient.actor, input.subjectType, input.subjectId))) return false;

    const [prefs] = await tx
      .select()
      .from(s.notificationPreferences)
      .where(eq(s.notificationPreferences.memberId, input.recipientId));
    if (prefs?.mutedKinds.includes(input.kind)) return false;

    const now = input.now ?? new Date();
    const { calendar, timeZone } = input.calendar ?? (await loadWorkCalendar(tx, input.tenantId));
    const deliverAt = deliverAfter(calendar, now, { timeZone, offHours: prefs?.offHours ?? false });
    if (input.notAfter && deliverAt > input.notAfter) return false;
    const [row] = await tx
      .insert(s.notifications)
      .values({
        recipientId: input.recipientId,
        kind: input.kind,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        actorId: input.actorId,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
        createdAt: now,
        deliverAfter: deliverAt,
      })
      .onConflictDoNothing()
      .returning({ id: s.notifications.id });
    if (!row) return false;
    // Realtime and device push (content-free; ADR 0011).
    await emitEvent(
      tx,
      'notification.created',
      { recipientId: input.recipientId, notificationId: row.id },
      input.actorId,
    );
    return true;
  }

  private async canSee(
    tx: Tx,
    actor: Parameters<typeof visibleTasks>[0],
    subjectType: NotificationSubject,
    subjectId: string,
  ): Promise<boolean> {
    if (subjectType === 'task') {
      const [row] = await tx
        .select({ id: s.tasks.id })
        .from(s.tasks)
        .where(and(eq(s.tasks.id, subjectId), isNull(s.tasks.deletedAt), visibleTasks(actor)));
      return Boolean(row);
    }
    if (subjectType === 'report') {
      const [report] = await tx
        .select({ scope: s.weeklyReports.scope, departmentId: s.weeklyReports.departmentId })
        .from(s.weeklyReports)
        .where(eq(s.weeklyReports.id, subjectId));
      return report ? readsReport(actor, report.departmentId) : false;
    }
    if (subjectType === 'conversation') {
      const [row] = await tx
        .select({ id: s.conversations.id })
        .from(s.conversations)
        .where(and(eq(s.conversations.id, subjectId), visibleConversations(actor.memberId)));
      return Boolean(row);
    }
    if (subjectType === 'letter') {
      const [row] = await tx
        .select({ id: s.letters.id })
        .from(s.letters)
        .where(
          and(
            eq(s.letters.id, subjectId),
            isNull(s.letters.deletedAt),
            visibleLetters(actor.memberId),
          ),
        );
      return Boolean(row);
    }
    if (subjectType === 'meeting') {
      const [row] = await tx
        .select({ id: s.meetings.id })
        .from(s.meetings)
        .where(and(eq(s.meetings.id, subjectId), visibleMeetings(actor)));
      return Boolean(row);
    }
    if (subjectType === 'progress') return subjectId === actor.memberId;
    if (subjectType === 'kudos') {
      const [row] = await tx
        .select({ id: s.kudos.id })
        .from(s.kudos)
        .where(and(eq(s.kudos.id, subjectId), visibleKudos(actor.memberId)));
      return Boolean(row);
    }
    if (subjectType === 'request') {
      const [row] = await tx
        .select({ id: s.approvalRequests.id })
        .from(s.approvalRequests)
        .where(and(eq(s.approvalRequests.id, subjectId), visibleRequests(actor)));
      return Boolean(row);
    }
    if (subjectType === 'goal') {
      const [row] = await tx
        .select({ id: s.goals.id })
        .from(s.goals)
        .where(and(eq(s.goals.id, subjectId), isNull(s.goals.archivedAt), visibleGoals(actor)));
      return Boolean(row);
    }
    const [row] = await tx
      .select({ id: s.projects.id })
      .from(s.projects)
      .where(and(eq(s.projects.id, subjectId), visibleProjects(actor)));
    return Boolean(row);
  }
}
