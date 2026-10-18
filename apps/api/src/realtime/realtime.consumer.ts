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
  'comment.created',
];
const HANDLED = [
  ...WORK,
  'daily_plan.updated',
  'notification.created',
  'project.member_added',
  'project.member_removed',
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
