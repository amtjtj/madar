import { emitEvent, schema as s, type Tx } from '@madar/db';
import { BADGES, badgesReached, type CounterKey } from '@madar/shared';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Badge counters (plan phase-3-step-18b). Recounted from their sources (finished work, kudos,
 * check-ins, the best streak and level) with the same limits as XP (a personal task with weight 1
 * and repeated check-ins in one week do not count), rather than added up event by event, so a capped,
 * reopened or deleted task can never leave a counter wrong; `member_counters` is the cached
 * result the badge page reads. A badge reached here is inserted once and kept for good.
 */
export async function refreshCounters(tx: Tx, memberId: string, timeZone: string): Promise<void> {
  const rows = await tx.execute<{ key: CounterKey; value: number }>(sql`
    select 'tasks_completed' as key, count(*)::int as value from tasks
      where assignee_id = ${memberId} and status_category = 'done' and deleted_at is null
        and not (source = 'personal' and weight = 1)
    union all
    select 'on_time', count(*)::int from tasks
      where assignee_id = ${memberId} and status_category = 'done' and deleted_at is null
        and not (source = 'personal' and weight = 1)
        and due_on is not null and (completed_at at time zone ${timeZone})::date <= due_on
    union all
    select 'kudos_received', count(*)::int from kudos where to_member_id = ${memberId}
    union all
    select 'kudos_given', count(*)::int from kudos where from_member_id = ${memberId}
    union all
    select 'goal_checkins', count(distinct (c.key_result_id, w.week))::int
      from key_result_checkins c
      join key_results kr on kr.id = c.key_result_id
      join goals g on g.id = kr.goal_id
      cross join lateral (
        select (c.created_at at time zone ${timeZone})::date as day
      ) d
      cross join lateral (
        -- Saturday of the Jalali week, as the weekly check-in XP counts it.
        select d.day - ((extract(dow from d.day)::int + 1) % 7) as week
      ) w
      where c.author_id = ${memberId} and g.owner_id = ${memberId}
    union all
    select 'longest_streak', coalesce(max(longest_streak), 0)::int from member_stats
      where member_id = ${memberId}
    union all
    select 'level', coalesce(max(best_level), 1)::int from member_stats where member_id = ${memberId}
  `);
  const counters: Partial<Record<CounterKey, number>> = {};
  for (const row of rows.rows) {
    counters[row.key] = row.value;
    await tx
      .insert(s.memberCounters)
      .values({ memberId, counterKey: row.key, value: row.value })
      .onConflictDoUpdate({
        target: [s.memberCounters.tenantId, s.memberCounters.memberId, s.memberCounters.counterKey],
        set: { value: row.value },
      });
  }
  for (const badge of badgesReached(counters)) {
    const inserted = await tx
      .insert(s.memberBadges)
      .values({ memberId, badgeKey: badge })
      .onConflictDoNothing()
      .returning({ key: s.memberBadges.badgeKey });
    if (inserted.length) await emitEvent(tx, 'member.badge_earned', { memberId, badge }, null);
  }
}

/** A member's earned badges, in catalog order. */
export async function earnedBadges(tx: Tx, memberId: string) {
  const rows = await tx
    .select({ key: s.memberBadges.badgeKey, awardedAt: s.memberBadges.awardedAt })
    .from(s.memberBadges)
    .where(eq(s.memberBadges.memberId, memberId));
  const at = new Map(rows.map((r) => [r.key, r.awardedAt]));
  return BADGES.flatMap((b) => {
    const awardedAt = at.get(b.key);
    return awardedAt ? [{ key: b.key, tier: b.tier, awardedAt: awardedAt.toISOString() }] : [];
  });
}

/** My counters (only ever read for the member themselves). */
export async function countersOf(tx: Tx, memberId: string) {
  const rows = await tx
    .select({ key: s.memberCounters.counterKey, value: s.memberCounters.value })
    .from(s.memberCounters)
    .where(and(eq(s.memberCounters.memberId, memberId)));
  return new Map(rows.map((r) => [r.key, r.value]));
}
