import { Injectable } from '@nestjs/common';
import { schema as s } from '@madar/db';
import type {
  ListNotificationsQuery,
  Notification,
  NotificationKind,
  NotificationList,
  NotificationPreferences,
  WorkCalendarDto,
} from '@madar/shared';
import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { loadWorkCalendar } from './calendar.js';

/** The signed-in member's notifications and settings. Every query is limited to the recipient. */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantDb) {}

  list(ctx: TenantContext, query: ListNotificationsQuery): Promise<NotificationList> {
    return this.db.run(ctx, async (tx) => {
      const mine = eq(s.notifications.recipientId, ctx.memberId);
      const rows = await tx
        .select({ n: s.notifications, actorName: s.members.displayName })
        .from(s.notifications)
        .leftJoin(s.members, eq(s.members.id, s.notifications.actorId))
        .where(and(mine, query.before ? lt(s.notifications.id, query.before) : undefined))
        .orderBy(desc(s.notifications.id))
        .limit(query.limit);
      const [unread] = await tx
        .select({ n: count() })
        .from(s.notifications)
        .where(and(mine, isNull(s.notifications.readAt)));
      return {
        items: rows.map(({ n, actorName }): Notification => {
          const payload = n.payload as { title?: string; data?: Record<string, string | number> };
          return {
            id: n.id,
            kind: n.kind as NotificationKind,
            subjectType: n.subjectType as 'task' | 'project',
            subjectId: n.subjectId,
            actor: n.actorId && actorName ? { id: n.actorId, displayName: actorName } : null,
            title: payload.title ?? '',
            data: payload.data ?? {},
            createdAt: n.createdAt.toISOString(),
            readAt: n.readAt?.toISOString() ?? null,
          };
        }),
        unreadCount: unread?.n ?? 0,
      };
    });
  }

  unreadCount(ctx: TenantContext): Promise<{ unreadCount: number }> {
    return this.db.run(ctx, async (tx) => {
      const [row] = await tx
        .select({ n: count() })
        .from(s.notifications)
        .where(and(eq(s.notifications.recipientId, ctx.memberId), isNull(s.notifications.readAt)));
      return { unreadCount: row?.n ?? 0 };
    });
  }

  markRead(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      const [row] = await tx
        .select({ id: s.notifications.id, readAt: s.notifications.readAt })
        .from(s.notifications)
        .where(and(eq(s.notifications.id, id), eq(s.notifications.recipientId, ctx.memberId)));
      if (!row) throw notFound('Notification');
      if (!row.readAt) {
        await tx
          .update(s.notifications)
          .set({ readAt: new Date() })
          .where(eq(s.notifications.id, id));
      }
    });
  }

  markAllRead(ctx: TenantContext): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      await tx
        .update(s.notifications)
        .set({ readAt: new Date() })
        .where(and(eq(s.notifications.recipientId, ctx.memberId), isNull(s.notifications.readAt)));
    });
  }

  preferences(ctx: TenantContext): Promise<NotificationPreferences> {
    return this.db.run(ctx, async (tx) => {
      const [row] = await tx
        .select()
        .from(s.notificationPreferences)
        .where(eq(s.notificationPreferences.memberId, ctx.memberId));
      return {
        mutedKinds: (row?.mutedKinds ?? []) as NotificationKind[],
        offHours: row?.offHours ?? false,
      };
    });
  }

  setPreferences(
    ctx: TenantContext,
    input: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    return this.db.run(ctx, async (tx) => {
      const values = { mutedKinds: [...new Set(input.mutedKinds)], offHours: input.offHours };
      await tx
        .insert(s.notificationPreferences)
        .values({ memberId: ctx.memberId, ...values })
        .onConflictDoUpdate({
          target: [s.notificationPreferences.tenantId, s.notificationPreferences.memberId],
          set: values,
        });
      return values;
    });
  }

  workCalendar(ctx: TenantContext): Promise<WorkCalendarDto> {
    return this.db.run(ctx, async (tx) => (await loadWorkCalendar(tx, ctx.tenantId)).calendar);
  }

  /** Owner only (checked by the controller); audited (ADR 0009). */
  setWorkCalendar(ctx: TenantContext, input: WorkCalendarDto): Promise<WorkCalendarDto> {
    return this.db.run(ctx, async (tx) => {
      const before = (await loadWorkCalendar(tx, ctx.tenantId)).calendar;
      const values = {
        weeklyHours: input.weeklyHours,
        holidays: [...new Set(input.holidays)].sort(),
        overdueEscalationDays: input.overdueEscalationDays,
      };
      await tx
        .insert(s.workCalendars)
        .values(values)
        .onConflictDoUpdate({ target: s.workCalendars.tenantId, set: values });
      await this.db.audit(tx, ctx, {
        action: 'work_calendar.updated',
        subjectType: 'tenant',
        subjectId: ctx.tenantId,
        before: before as unknown as Record<string, unknown>,
        after: values as unknown as Record<string, unknown>,
      });
      return values;
    });
  }
}
