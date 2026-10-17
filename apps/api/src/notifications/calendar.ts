import { schema as s, type Tx } from '@madar/db';
import { DEFAULT_WORK_CALENDAR, type WorkCalendar } from '@madar/shared';
import { eq } from 'drizzle-orm';

/** The tenant's work calendar (the product default when none is saved) and time zone. */
export async function loadWorkCalendar(
  tx: Tx,
  tenantId: string,
): Promise<{ calendar: WorkCalendar; timeZone: string }> {
  const [row] = await tx.select().from(s.workCalendars);
  const [tenant] = await tx
    .select({ timezone: s.tenants.timezone })
    .from(s.tenants)
    .where(eq(s.tenants.id, tenantId));
  return {
    calendar: row
      ? {
          weeklyHours: row.weeklyHours,
          holidays: row.holidays,
          overdueEscalationDays: row.overdueEscalationDays,
        }
      : DEFAULT_WORK_CALENDAR,
    timeZone: tenant?.timezone ?? 'Asia/Tehran',
  };
}
