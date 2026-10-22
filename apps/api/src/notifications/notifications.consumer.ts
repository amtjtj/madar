import { Injectable } from '@nestjs/common';
import { schema as s, type OutboxEvent, type Tx } from '@madar/db';
import { calendarDateIn } from '@madar/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { EventConsumer } from '../events/consumer.js';
import { Notifier } from './notifier.js';

const HANDLED = [
  'task.assigned',
  'task.progress_updated',
  'comment.created',
  'project.member_added',
  'letter.sent',
  'letter.referred',
  'task.evidence_pinned',
  'message.created',
  'message.updated',
];

/** Turns domain events into in-app notifications. */
@Injectable()
export class NotificationsConsumer implements EventConsumer {
  readonly name = 'notifications';

  constructor(private readonly notifier: Notifier) {}

  handles(type: string): boolean {
    return HANDLED.includes(type);
  }

  async handle(tx: Tx, event: OutboxEvent): Promise<void> {
    const p = event.payload;
    const base = { tenantId: event.tenantId, actorId: event.actorId, now: event.occurredAt };
    switch (event.type) {
      case 'task.assigned': {
        const task = await this.task(tx, String(p.taskId));
        if (!task || !p.assigneeId) return;
        await this.notifier.notify(tx, {
          ...base,
          recipientId: String(p.assigneeId),
          kind: 'task_assigned',
          subjectType: 'task',
          subjectId: task.id,
          payload: { title: task.title },
          dedupeKey: `event:${event.id}`,
        });
        return;
      }
      case 'task.progress_updated': {
        // To whoever assigned or asked for the task; at most once a day per task (ADR 0018).
        if (p.computed) return; // a parent following its subtasks
        const task = await this.task(tx, String(p.taskId));
        if (!task?.sourceMemberId || (task.source !== 'assigned' && task.source !== 'request')) {
          return;
        }
        const [tenant] = await tx
          .select({ timezone: s.tenants.timezone })
          .from(s.tenants)
          .where(eq(s.tenants.id, event.tenantId));
        const day = calendarDateIn(event.occurredAt, tenant?.timezone);
        await this.notifier.notify(tx, {
          ...base,
          recipientId: task.sourceMemberId,
          kind: 'task_progress',
          subjectType: 'task',
          subjectId: task.id,
          payload: { title: task.title, data: { progress: Number(p.to) } },
          dedupeKey: `task_progress:${task.id}:${day}`,
        });
        return;
      }
      case 'message.created':
      case 'message.updated': {
        const conversation = await this.conversationOf(tx, String(p.conversationId));
        if (!conversation) return;
        const direct = conversation.kind === 'direct';
        // A message deleted before the worker ran tells no one.
        const [message] = await tx
          .select({ deletedAt: s.messages.deletedAt })
          .from(s.messages)
          .where(eq(s.messages.id, String(p.messageId)));
        if (!message || message.deletedAt) return;
        // Mentions reach people in every kind of conversation, muted or not (plan 15b).
        const mentioned = ((p.mentionIds as string[] | undefined) ?? []).filter(
          (id) => id !== event.actorId,
        );
        const told = new Set<string>();
        for (const recipientId of mentioned) {
          const sent = await this.notifier.notify(tx, {
            ...base,
            recipientId,
            kind: 'chat_mention',
            subjectType: 'conversation',
            subjectId: conversation.id,
            payload: direct ? { title: '', data: { direct: 1 } } : { title: conversation.title },
            dedupeKey: `mention:${String(p.messageId)}:${recipientId}`,
          });
          if (sent) told.add(recipientId);
        }
        // Direct and group only, one notification per conversation until it is read (ADR 0022);
        // channels show an unread count instead. Someone told about a mention is not told twice;
        // someone who turned mention notifications off still gets the message one.
        if (event.type !== 'message.created') return;
        if (conversation.kind !== 'direct' && conversation.kind !== 'group') return;
        const people = await tx
          .select({
            memberId: s.conversationMembers.memberId,
            muted: s.conversationMembers.muted,
            lastRead: s.conversationMembers.lastReadMessageId,
            joinedAt: s.conversationMembers.joinedAt,
          })
          .from(s.conversationMembers)
          .where(
            and(
              eq(s.conversationMembers.conversationId, conversation.id),
              isNull(s.conversationMembers.leftAt),
            ),
          );
        for (const person of people) {
          if (person.muted || told.has(person.memberId)) continue;
          // Already read up to (or past) this message: nothing to tell.
          if (person.lastRead && person.lastRead >= String(p.messageId)) continue;
          await this.notifier.notify(tx, {
            ...base,
            recipientId: person.memberId,
            kind: 'chat_message',
            subjectType: 'conversation',
            subjectId: conversation.id,
            payload: direct ? { title: '', data: { direct: 1 } } : { title: conversation.title },
            // One per read mark; a re-added member (new joinedAt, no read mark) is told again.
            dedupeKey: `chat:${conversation.id}:${person.lastRead ?? `joined-${person.joinedAt.getTime()}`}`,
          });
        }
        return;
      }
      case 'task.evidence_pinned': {
        // To the assignee and whoever assigned or asked for it (ADR 0021).
        const task = await this.task(tx, String(p.taskId));
        if (!task) return;
        const recipients = new Set(
          [task.assigneeId, task.sourceMemberId ?? task.reporterId].filter((id): id is string =>
            Boolean(id),
          ),
        );
        for (const recipientId of recipients) {
          await this.notifier.notify(tx, {
            ...base,
            recipientId,
            kind: 'task_evidence_pinned',
            subjectType: 'task',
            subjectId: task.id,
            payload: { title: task.title },
            dedupeKey: `event:${event.id}`,
          });
        }
        return;
      }
      case 'comment.created': {
        const task = await this.task(tx, String(p.taskId));
        if (!task) return;
        const people = await tx
          .select({ memberId: s.taskCollaborators.memberId })
          .from(s.taskCollaborators)
          .where(eq(s.taskCollaborators.taskId, task.id));
        const recipients = new Set(
          [task.assigneeId, task.reporterId, ...people.map((c) => c.memberId)].filter(
            (id): id is string => Boolean(id),
          ),
        );
        for (const recipientId of recipients) {
          await this.notifier.notify(tx, {
            ...base,
            recipientId,
            kind: 'task_commented',
            subjectType: 'task',
            subjectId: task.id,
            payload: { title: task.title },
            dedupeKey: `event:${event.id}`,
          });
        }
        return;
      }
      case 'letter.sent':
      case 'letter.referred': {
        const [letter] = await tx
          .select({
            id: s.letters.id,
            subject: s.letters.subject,
            urgency: s.letters.urgency,
            confidential: s.letters.confidential,
          })
          .from(s.letters)
          .where(eq(s.letters.id, String(p.letterId)));
        if (!letter) return;
        const sent = event.type === 'letter.sent';
        const recipients = sent
          ? (
              await tx
                .select({ memberId: s.letterRecipients.memberId })
                .from(s.letterRecipients)
                .where(
                  and(
                    eq(s.letterRecipients.letterId, letter.id),
                    inArray(s.letterRecipients.kind, ['to', 'cc']),
                  ),
                )
            ).map((r) => r.memberId)
          : ((p.memberIds as string[] | undefined) ?? []);
        for (const recipientId of recipients) {
          await this.notifier.notify(tx, {
            ...base,
            recipientId,
            kind: sent ? 'letter_received' : 'letter_referred',
            subjectType: 'letter',
            subjectId: letter.id,
            // A confidential letter's subject never leaves the letter (ADR 0020).
            payload: letter.confidential
              ? { title: '', data: { confidential: 1, urgency: letter.urgency } }
              : { title: letter.subject, data: { urgency: letter.urgency } },
            dedupeKey: `event:${event.id}`,
          });
        }
        return;
      }
      case 'project.member_added': {
        const [project] = await tx
          .select({ id: s.projects.id, name: s.projects.name })
          .from(s.projects)
          .where(eq(s.projects.id, String(p.projectId)));
        if (!project) return;
        for (const recipientId of (p.memberIds as string[] | undefined) ?? []) {
          await this.notifier.notify(tx, {
            ...base,
            recipientId,
            kind: 'project_member_added',
            subjectType: 'project',
            subjectId: project.id,
            payload: {
              title: project.name,
              ...(p.roles && typeof p.roles === 'object'
                ? {
                    data: {
                      role: String((p.roles as Record<string, string>)[recipientId] ?? 'member'),
                    },
                  }
                : {}),
            },
            dedupeKey: `event:${event.id}`,
          });
        }
        return;
      }
    }
  }

  private async task(tx: Tx, id: string) {
    const [task] = await tx
      .select({
        id: s.tasks.id,
        title: s.tasks.title,
        assigneeId: s.tasks.assigneeId,
        reporterId: s.tasks.reporterId,
        source: s.tasks.source,
        sourceMemberId: s.tasks.sourceMemberId,
        deletedAt: s.tasks.deletedAt,
      })
      .from(s.tasks)
      .where(eq(s.tasks.id, id));
    return task && !task.deletedAt ? task : null;
  }

  /** A conversation's kind and the title people know it by (project, department or group). */
  private async conversationOf(tx: Tx, id: string) {
    const [row] = await tx
      .select({
        id: s.conversations.id,
        kind: s.conversations.kind,
        title: s.conversations.title,
        project: s.projects.name,
        department: s.departments.name,
      })
      .from(s.conversations)
      .leftJoin(s.projects, eq(s.projects.id, s.conversations.projectId))
      .leftJoin(s.departments, eq(s.departments.id, s.conversations.departmentId))
      .where(eq(s.conversations.id, id));
    if (!row) return null;
    return { id: row.id, kind: row.kind, title: row.title ?? row.project ?? row.department ?? '' };
  }
}
