import { Inject, Injectable, Logger } from '@nestjs/common';
import { listActiveTenants, schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  MEETING_REMINDER_MINUTES,
  addDays,
  calendarDateIn,
  SERIES_HORIZON_WEEKS,
} from '@madar/shared';
import { and, gt, isNull, lt, lte, ne, or, eq } from 'drizzle-orm';

import { DB_HANDLE } from '../database/tokens.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { Notifier } from '../notifications/notifier.js';
import { generateSeries } from './meetings.service.js';

/**
 * Worker jobs for meetings (plan phase-2-step-13b): keeping weekly series made eight weeks
 * ahead, and the «جلسه تا ۱۰ دقیقه دیگر» reminder. Each tenant runs in its own transaction.
 */
@Injectable()
export class MeetingJobs {
  private readonly logger = new Logger('MeetingJobs');

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly notifier: Notifier,
  ) {}

  private async eachTenant(run: (tenantId: string) => Promise<unknown>): Promise<void> {
    for (const tenant of await listActiveTenants(this.handle.db)) {
      try {
        await run(tenant.id);
      } catch (error) {
        this.logger.error(`tenant ${tenant.id}: ${String(error)}`);
      }
    }
  }

  generateAll(now = new Date()): Promise<void> {
    return this.eachTenant((tenantId) => this.generateForTenant(tenantId, now));
  }

  /** Series not canceled and not yet made up to the horizon (or their last day). */
  generateForTenant(tenantId: string, now = new Date()): Promise<number> {
    return withTenant(this.handle.db, { tenantId }, async (tx) => {
      const loaded = await loadWorkCalendar(tx, tenantId);
      const horizon = addDays(calendarDateIn(now, loaded.timeZone), SERIES_HORIZON_WEEKS * 7);
      const due = await tx
        .select()
        .from(s.meetingSeries)
        .where(
          and(
            isNull(s.meetingSeries.canceledAt),
            lt(s.meetingSeries.generatedUntil, horizon),
            or(
              isNull(s.meetingSeries.untilOn),
              gt(s.meetingSeries.untilOn, s.meetingSeries.generatedUntil),
            ),
          ),
        )
        // A series being changed right now is skipped; the next run sees its new rule.
        .for('update', { skipLocked: true });
      let made = 0;
      for (const series of due) made += (await generateSeries(tx, series, loaded, now)).length;
      return made;
    });
  }

  remindAll(now = new Date()): Promise<void> {
    return this.eachTenant((tenantId) => this.remindForTenant(tenantId, now));
  }

  /**
   * Everyone coming (not «نمی‌آیم») to a meeting that starts within ten minutes, once each; never
   * when quiet hours would hold it until after the start.
   */
  remindForTenant(tenantId: string, now = new Date()): Promise<number> {
    return withTenant(this.handle.db, { tenantId }, async (tx) => {
      const loaded = await loadWorkCalendar(tx, tenantId);
      const soon = new Date(now.getTime() + MEETING_REMINDER_MINUTES * 60_000);
      const rows = await tx
        .select({
          meetingId: s.meetings.id,
          title: s.meetings.title,
          startsAt: s.meetings.startsAt,
          memberId: s.meetingParticipants.memberId,
        })
        .from(s.meetings)
        .innerJoin(s.meetingParticipants, eq(s.meetingParticipants.meetingId, s.meetings.id))
        .where(
          and(
            isNull(s.meetings.canceledAt),
            gt(s.meetings.startsAt, now),
            lte(s.meetings.startsAt, soon),
            ne(s.meetingParticipants.response, 'declined'),
          ),
        );
      let sent = 0;
      for (const row of rows) {
        const created = await this.notifier.notify(tx, {
          tenantId,
          recipientId: row.memberId,
          kind: 'meeting_reminder',
          subjectType: 'meeting',
          subjectId: row.meetingId,
          actorId: null,
          payload: { title: row.title, data: { startsAt: row.startsAt.toISOString() } },
          // A meeting moved later reminds again.
          dedupeKey: `remind:${row.meetingId}:${row.memberId}:${row.startsAt.toISOString()}`,
          now,
          notAfter: row.startsAt,
          calendar: loaded,
        });
        if (created) sent++;
      }
      return sent;
    });
  }
}
