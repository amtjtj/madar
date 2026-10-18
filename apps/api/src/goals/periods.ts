import { schema as s, type Tx } from '@madar/db';
import { calendarDateIn, jalaliQuarterOf, nextJalaliQuarter, type GoalPeriod } from '@madar/shared';
import { desc, eq } from 'drizzle-orm';

/** Today in the tenant's time zone. */
export async function tenantToday(tx: Tx, tenantId: string): Promise<string> {
  const [tenant] = await tx
    .select({ timezone: s.tenants.timezone })
    .from(s.tenants)
    .where(eq(s.tenants.id, tenantId));
  return calendarDateIn(new Date(), tenant?.timezone);
}

/** The current and next Jalali seasons exist as periods (idempotent). */
export async function ensurePeriods(tx: Tx, today: string): Promise<void> {
  const current = jalaliQuarterOf(today);
  const next = nextJalaliQuarter(current);
  await tx
    .insert(s.goalPeriods)
    .values(
      [current, next].map(({ year, quarter, startOn, endOn }) => ({
        year,
        quarter,
        startOn,
        endOn,
      })),
    )
    .onConflictDoNothing();
}

export async function listPeriods(tx: Tx, today: string): Promise<GoalPeriod[]> {
  const rows = await tx.select().from(s.goalPeriods).orderBy(desc(s.goalPeriods.startOn));
  return rows.map((p) => ({
    id: p.id,
    year: p.year,
    quarter: p.quarter,
    startOn: p.startOn,
    endOn: p.endOn,
    current: p.startOn <= today && today <= p.endOn,
  }));
}
