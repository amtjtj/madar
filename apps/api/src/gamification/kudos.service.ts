import { HttpStatus, Injectable } from '@nestjs/common';
import { emitEvent, schema as s, type Tx } from '@madar/db';
import {
  BADGES,
  KUDOS_SAME_PERSON_MAX,
  calendarDateIn,
  isPublicBadge,
  weekStartOf,
  type GiveKudosRequest,
  type KudosAllowance,
  type KudosItem,
  type ListKudosQuery,
  type MemberProfile,
  type MyBadge,
} from '@madar/shared';
import { and, count, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { ApiError, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { visibleTasks } from '../work/access.js';
import { visibleKudos } from './access.js';
import { countersOf, earnedBadges } from './counters.js';
import { loadGamificationSettings } from './settings.js';

type KudosRow = typeof s.kudos.$inferSelect;

/**
 * A colleague's thanks and badges (plan phase-3-step-18b, ADR 0030). Kudos are read through
 * `visibleKudos`; counts of kudos or badges are never compared or ordered across people.
 */
@Injectable()
export class KudosService {
  constructor(private readonly db: TenantDb) {}

  give(ctx: TenantContext, body: GiveKudosRequest): Promise<KudosItem> {
    return this.db.run(ctx, async (tx) => {
      const me = ctx.memberId;
      const settings = await loadGamificationSettings(tx, ctx.tenantId);
      if (!settings.enabled) {
        throw new ApiError(HttpStatus.CONFLICT, 'gamification_off', 'Gamification is off');
      }
      if (body.toMemberId === me) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'kudos_self', 'Cannot thank yourself');
      }
      const [to] = await tx
        .select({ id: s.members.id })
        .from(s.members)
        .where(and(eq(s.members.id, body.toMemberId), eq(s.members.status, 'active')));
      if (!to) throw notFound('Member');
      if (body.taskId) {
        const [task] = await tx
          .select({ id: s.tasks.id })
          .from(s.tasks)
          .where(
            and(eq(s.tasks.id, body.taskId), isNull(s.tasks.deletedAt), visibleTasks(ctx.actor)),
          );
        if (!task) throw notFound('Task');
      }
      // One allowance check per giver at a time.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`kudos:${me}`}, 0))`);
      const { timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
      const weekStart = weekStartOf(calendarDateIn(new Date(), timeZone));
      const given = await tx
        .select({ to: s.kudos.toMemberId, n: count() })
        .from(s.kudos)
        .where(and(eq(s.kudos.fromMemberId, me), eq(s.kudos.weekStart, weekStart)))
        .groupBy(s.kudos.toMemberId);
      const total = given.reduce((sum, g) => sum + g.n, 0);
      if (total >= settings.kudosPerWeek) {
        throw new ApiError(HttpStatus.CONFLICT, 'kudos_limit', 'No thanks left this week');
      }
      if ((given.find((g) => g.to === body.toMemberId)?.n ?? 0) >= KUDOS_SAME_PERSON_MAX) {
        throw new ApiError(HttpStatus.CONFLICT, 'kudos_same_person', 'Thank someone else too');
      }
      const [row] = await tx
        .insert(s.kudos)
        .values({
          fromMemberId: me,
          toMemberId: body.toMemberId,
          valueTag: body.valueTag,
          message: body.message,
          taskId: body.taskId ?? null,
          private: body.private,
          weekStart,
        })
        .returning();
      if (!row) throw new Error('kudos insert failed');
      await emitEvent(
        tx,
        'kudos.given',
        {
          kudosId: row.id,
          fromMemberId: me,
          toMemberId: body.toMemberId,
          private: body.private,
        },
        me,
      );
      const [item] = await this.items(tx, ctx, [row]);
      if (!item) throw new Error('kudos read failed');
      return item;
    });
  }

  list(ctx: TenantContext, query: ListKudosQuery): Promise<KudosItem[]> {
    return this.db.run(ctx, async (tx) => {
      const me = ctx.memberId;
      const rows = await tx
        .select()
        .from(s.kudos)
        .where(
          and(
            visibleKudos(me),
            query.member
              ? and(
                  eq(s.kudos.toMemberId, query.member),
                  // On someone else's profile, what they hid stays hidden.
                  query.member === me ? undefined : isNull(s.kudos.hiddenAt),
                )
              : and(eq(s.kudos.private, false), isNull(s.kudos.hiddenAt)),
            query.before ? lt(s.kudos.id, query.before) : undefined,
          ),
        )
        .orderBy(desc(s.kudos.id))
        .limit(query.limit);
      return this.items(tx, ctx, rows);
    });
  }

  hide(ctx: TenantContext, id: string): Promise<void> {
    return this.db.run(ctx, async (tx) => {
      const [row] = await tx
        .update(s.kudos)
        .set({ hiddenAt: new Date() })
        .where(
          and(eq(s.kudos.id, id), eq(s.kudos.toMemberId, ctx.memberId), isNull(s.kudos.hiddenAt)),
        )
        .returning({ id: s.kudos.id, private: s.kudos.private });
      if (!row) {
        // Already hidden is fine; anything else is not mine to hide.
        const [mine] = await tx
          .select({ id: s.kudos.id })
          .from(s.kudos)
          .where(and(eq(s.kudos.id, id), eq(s.kudos.toMemberId, ctx.memberId)));
        if (!mine) throw notFound('Kudos');
        return;
      }
      await emitEvent(
        tx,
        'kudos.hidden',
        { kudosId: id, toMemberId: ctx.memberId, private: row.private },
        ctx.memberId,
      );
    });
  }

  allowance(ctx: TenantContext): Promise<KudosAllowance> {
    return this.db.run(ctx, async (tx) => {
      const settings = await loadGamificationSettings(tx, ctx.tenantId);
      const { timeZone } = await loadWorkCalendar(tx, ctx.tenantId);
      const weekStart = weekStartOf(calendarDateIn(new Date(), timeZone));
      const [row] = await tx
        .select({ n: count() })
        .from(s.kudos)
        .where(and(eq(s.kudos.fromMemberId, ctx.memberId), eq(s.kudos.weekStart, weekStart)));
      return {
        enabled: settings.enabled,
        perWeek: settings.kudosPerWeek,
        left: Math.max(0, settings.kudosPerWeek - (row?.n ?? 0)),
        weekStart,
      };
    });
  }

  profile(ctx: TenantContext, memberId: string): Promise<MemberProfile> {
    return this.db.run(ctx, async (tx) => {
      const [member] = await tx
        .select({ id: s.members.id, displayName: s.members.displayName })
        .from(s.members)
        .where(eq(s.members.id, memberId));
      if (!member) throw notFound('Member');
      const departments = await tx
        .select({
          id: s.departments.id,
          name: s.departments.name,
          deptRole: s.departmentMemberships.deptRole,
        })
        .from(s.departmentMemberships)
        .innerJoin(s.departments, eq(s.departments.id, s.departmentMemberships.departmentId))
        .where(
          and(eq(s.departmentMemberships.memberId, memberId), isNull(s.departments.archivedAt)),
        );
      const settings = await loadGamificationSettings(tx, ctx.tenantId);
      return {
        ...member,
        departments,
        // Level and streak badges are their owner's alone (ADR 0029).
        badges: settings.enabled
          ? (await earnedBadges(tx, memberId)).filter(
              (b) => memberId === ctx.memberId || isPublicBadge(b.key),
            )
          : [],
        gamification: settings.enabled,
        me: memberId === ctx.memberId,
      };
    });
  }

  myBadges(ctx: TenantContext): Promise<MyBadge[]> {
    return this.db.run(ctx, async (tx) => {
      const counters = await countersOf(tx, ctx.memberId);
      const earned = new Map(
        (await earnedBadges(tx, ctx.memberId)).map((b) => [b.key, b.awardedAt]),
      );
      return BADGES.map((b) => ({
        key: b.key,
        tier: b.tier,
        counter: b.counter,
        value: Math.min(counters.get(b.counter) ?? 0, b.gte),
        goal: b.gte,
        awardedAt: earned.get(b.key) ?? null,
      }));
    });
  }

  /** Names, and the task's title only when this reader sees the task too. */
  private async items(tx: Tx, ctx: TenantContext, rows: KudosRow[]): Promise<KudosItem[]> {
    if (!rows.length) return [];
    const ids = [...new Set(rows.flatMap((r) => [r.fromMemberId, r.toMemberId]))];
    const people = await tx
      .select({ id: s.members.id, displayName: s.members.displayName })
      .from(s.members)
      .where(inArray(s.members.id, ids));
    const name = new Map(people.map((p) => [p.id, p.displayName]));
    const taskIds = rows.flatMap((r) => (r.taskId ? [r.taskId] : []));
    const tasks = taskIds.length
      ? await tx
          .select({ id: s.tasks.id, title: s.tasks.title })
          .from(s.tasks)
          .where(
            and(inArray(s.tasks.id, taskIds), isNull(s.tasks.deletedAt), visibleTasks(ctx.actor)),
          )
      : [];
    const task = new Map(tasks.map((t) => [t.id, t]));
    const person = (id: string) => ({ id, displayName: name.get(id) ?? '' });
    return rows.map((r) => ({
      id: r.id,
      from: person(r.fromMemberId),
      to: person(r.toMemberId),
      valueTag: r.valueTag,
      message: r.message,
      task: r.taskId ? (task.get(r.taskId) ?? null) : null,
      private: r.private,
      hidden: r.hiddenAt !== null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
