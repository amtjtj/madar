import { Inject, Injectable } from '@nestjs/common';
import { schema as s, type OutboxEvent, type Tx } from '@madar/db';
import { REALTIME_EVENTS } from '@madar/shared';
import { Emitter } from '@socket.io/redis-emitter';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { REDIS, type EventConsumer } from '../events/consumer.js';
import { departmentRoom, everyoneRoom, memberRoom, projectRoom, readersRoom } from './rooms.js';

const WORK = [
  'task.created',
  'task.assigned',
  'task.status_changed',
  'task.completed',
  'task.reopened',
  'task.deleted',
  'task.progress_updated',
  'attachment.added',
  'attachment.removed',
  'task.evidence_pinned',
  'task.evidence_unpinned',
  'comment.created',
];
const HANDLED = [
  ...WORK,
  'daily_plan.updated',
  'notification.created',
  'project.member_added',
  'project.member_removed',
  'letter.sent',
  'letter.referred',
  'letter.read',
  'meeting.scheduled',
  'meeting.updated',
  'meeting.canceled',
  'meeting.minutes_recorded',
  'meeting.decision_converted',
  'meeting.response_changed',
  'meeting.series_scheduled',
  'meeting.series_updated',
  'meeting.series_canceled',
  'request.submitted',
  'request.advanced',
  'request.decided',
  'request.canceled',
  'member.progress_changed',
];

/**
 * Fans domain events out to Socket.IO rooms through Redis. Rooms come from the event's tenant only;
 * a task in a private project reaches its project room and the people involved, never the
 * department or readers room; company-wide projects reach everyone. Messages carry no data.
 */
@Injectable()
export class RealtimeConsumer implements EventConsumer {
  readonly name = 'realtime';
  private readonly emitter: Emitter;
  /** Emits planned inside the transaction, sent only after it commits. */
  private readonly planned = new Map<string, Array<() => void>>();

  constructor(@Inject(REDIS) redis: Redis) {
    this.emitter = new Emitter(redis);
  }

  handles(type: string): boolean {
    return HANDLED.includes(type);
  }

  async handle(tx: Tx, event: OutboxEvent): Promise<void> {
    const emits: Array<() => void> = [];
    this.planned.set(event.id, emits);
    await this.plan(tx, event, emits);
  }

  async afterCommit(event: OutboxEvent): Promise<void> {
    const emits = this.planned.get(event.id) ?? [];
    this.planned.delete(event.id);
    for (const emit of emits) emit();
  }

  private async plan(tx: Tx, event: OutboxEvent, emits: Array<() => void>): Promise<void> {
    const t = event.tenantId;
    const p = event.payload;
    if (event.type === 'notification.created' && p.recipientId) {
      emits.push(() =>
        this.emitter
          .to(memberRoom(t, String(p.recipientId)))
          .emit(REALTIME_EVENTS.notificationsChanged),
      );
      return;
    }
    if (event.type === 'daily_plan.updated' && p.memberId) {
      emits.push(() =>
        this.emitter.to(memberRoom(t, String(p.memberId))).emit(REALTIME_EVENTS.todayChanged),
      );
      return;
    }
    if (event.type === 'project.member_added' && p.projectId) {
      const members = ((p.memberIds as string[] | undefined) ?? []).map((m) => memberRoom(t, m));
      if (members.length) {
        // Sockets already connected start receiving the project's updates at once.
        emits.push(() => this.emitter.in(members).socketsJoin(projectRoom(t, String(p.projectId))));
        emits.push(() => this.emitter.to(members).emit(REALTIME_EVENTS.workChanged));
        // The project's team chat appears in their conversations (ADR 0022).
        emits.push(() => this.emitter.to(members).emit(REALTIME_EVENTS.chatChanged));
      }
      return;
    }
    if (event.type === 'project.member_removed' && p.projectId) {
      const members = ((p.memberIds as string[] | undefined) ?? []).map((m) => memberRoom(t, m));
      if (members.length) {
        emits.push(() =>
          this.emitter.in(members).socketsLeave(projectRoom(t, String(p.projectId))),
        );
        emits.push(() => this.emitter.to(members).emit(REALTIME_EVENTS.workChanged));
        emits.push(() => this.emitter.to(members).emit(REALTIME_EVENTS.chatChanged));
      }
      return;
    }
    if (event.type.startsWith('meeting.') && (p.meetingId || p.seriesId)) {
      // The people taking part (in the series, for a series change), and anyone just removed.
      const rows = p.seriesId
        ? await tx
            .select({ memberId: s.meetingSeriesParticipants.memberId })
            .from(s.meetingSeriesParticipants)
            .where(eq(s.meetingSeriesParticipants.seriesId, String(p.seriesId)))
        : await tx
            .select({ memberId: s.meetingParticipants.memberId })
            .from(s.meetingParticipants)
            .where(eq(s.meetingParticipants.meetingId, String(p.meetingId)));
      const people = new Set([
        ...rows.map((r) => r.memberId),
        ...((p.removedIds as string[] | undefined) ?? []),
      ]);
      const rooms = [...people].map((m) => memberRoom(t, m));
      if (rooms.length) {
        emits.push(() => this.emitter.to(rooms).emit(REALTIME_EVENTS.meetingsChanged));
      }
      return;
    }
    if (event.type === 'member.progress_changed' && p.memberId) {
      // XP and streak are only ever the member's own (ADR 0029).
      const room = memberRoom(t, String(p.memberId));
      emits.push(() => this.emitter.to(room).emit(REALTIME_EVENTS.progressChanged));
      return;
    }
    if (event.type.startsWith('request.') && p.requestId) {
      // The requester and every approver of the request refresh their lists (ADR 0028).
      const [request] = await tx
        .select({
          requesterId: s.approvalRequests.requesterId,
          snapshot: s.approvalRequests.snapshot,
        })
        .from(s.approvalRequests)
        .where(eq(s.approvalRequests.id, String(p.requestId)));
      if (!request) return;
      const rooms = [...new Set([request.requesterId, ...request.snapshot.approvers])].map((m) =>
        memberRoom(t, m),
      );
      emits.push(() => this.emitter.to(rooms).emit(REALTIME_EVENTS.requestsChanged));
      return;
    }
    if (event.type.startsWith('letter.') && p.letterId) {
      const rooms = (await this.letterPeople(tx, String(p.letterId), event.type)).map((m) =>
        memberRoom(t, m),
      );
      if (rooms.length) {
        emits.push(() => this.emitter.to(rooms).emit(REALTIME_EVENTS.lettersChanged));
      }
      return;
    }
    if (WORK.includes(event.type) && p.taskId) {
      const rooms = await this.taskRooms(tx, t, String(p.taskId));
      if (rooms.length) {
        emits.push(() => this.emitter.to(rooms).emit(REALTIME_EVENTS.workChanged));
        // Completing or reopening a planned task changes «today» too: the people involved refetch it.
        emits.push(() => this.emitter.to(rooms).emit(REALTIME_EVENTS.todayChanged));
      }
    }
  }

  /**
   * Who refetches letters: everyone on a letter that was sent or referred; only the sender and
   * referrers when someone reads it (they are the ones who see read state).
   */
  private async letterPeople(tx: Tx, letterId: string, type: string): Promise<string[]> {
    const [letter] = await tx
      .select({ senderId: s.letters.senderId, sentAt: s.letters.sentAt })
      .from(s.letters)
      .where(eq(s.letters.id, letterId));
    if (!letter?.sentAt) return [];
    const rows = await tx
      .select({ memberId: s.letterRecipients.memberId, referredBy: s.letterRecipients.referredBy })
      .from(s.letterRecipients)
      .where(eq(s.letterRecipients.letterId, letterId));
    const people = new Set([letter.senderId]);
    for (const row of rows) {
      if (row.referredBy) people.add(row.referredBy);
      if (type !== 'letter.read') people.add(row.memberId);
    }
    return [...people];
  }

  private async taskRooms(tx: Tx, tenantId: string, taskId: string): Promise<string[]> {
    const [task] = await tx
      .select({
        departmentId: s.tasks.departmentId,
        projectId: s.tasks.projectId,
        assigneeId: s.tasks.assigneeId,
        reporterId: s.tasks.reporterId,
        visibility: s.projects.visibility,
      })
      .from(s.tasks)
      .leftJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
      .where(eq(s.tasks.id, taskId));
    if (!task) return [];
    const people = await tx
      .select({ memberId: s.taskCollaborators.memberId })
      .from(s.taskCollaborators)
      .where(eq(s.taskCollaborators.taskId, taskId));
    const rooms = new Set<string>();
    for (const id of [task.assigneeId, task.reporterId, ...people.map((c) => c.memberId)]) {
      if (id) rooms.add(memberRoom(tenantId, id));
    }
    if (task.projectId) rooms.add(projectRoom(tenantId, task.projectId));
    if (task.visibility !== 'private') {
      rooms.add(departmentRoom(tenantId, task.departmentId));
      rooms.add(readersRoom(tenantId)); // company-wide readers see everything but private projects
    }
    if (task.visibility === 'tenant') rooms.add(everyoneRoom(tenantId));
    return [...rooms];
  }
}
