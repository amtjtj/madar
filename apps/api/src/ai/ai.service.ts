import { HttpStatus, Injectable } from '@nestjs/common';
import { schema as s } from '@madar/db';
import {
  calendarDateIn,
  formatCalendarDate,
  workingDayAfter,
  type AiSettings,
  type AiStatus,
  type TaskBreakdownRequest,
  type TaskBreakdownResponse,
} from '@madar/shared';
import { and, eq, sql } from 'drizzle-orm';

import type { TenantContext } from '../common/context.js';
import { ApiError, forbidden, notFound } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { loadWorkCalendar } from '../notifications/calendar.js';
import { canCreateIn } from '../work/access.js';
import { AiClient } from './ai-client.js';
import { AiLimiter } from './limiter.js';
import { loadAiSettings } from './settings.js';

/**
 * The assistant's requests from people (plan phase-3-step-16a, ADR 0025). Everything it returns is
 * a suggestion: tasks are made by the person, through `POST /api/tasks`.
 */
@Injectable()
export class AiService {
  /** «جمله به کار»: ten a minute per person, sixty per company. */
  private readonly limiter = new AiLimiter(10, 60);

  constructor(
    private readonly db: TenantDb,
    private readonly client: AiClient,
  ) {}

  status(ctx: TenantContext): Promise<AiStatus> {
    return this.db.run(ctx, async (tx) => ({
      available: this.client.available,
      enabled: (await loadAiSettings(tx, ctx.tenantId)).enabled,
    }));
  }

  /** Admins' status page: whether the service and its model answer right now. */
  health(): Promise<{ reachable: boolean; modelReachable: boolean }> {
    return this.client.health();
  }

  setSettings(ctx: TenantContext, body: AiSettings): Promise<AiSettings> {
    return this.db.run(ctx, async (tx) => {
      const before = await loadAiSettings(tx, ctx.tenantId);
      await tx
        .update(s.tenants)
        .set({ settings: sql`${s.tenants.settings} || ${JSON.stringify({ ai: body })}::jsonb` })
        // `tenants` is control-plane (no RLS): the session's tenant guards the row as well.
        .where(and(eq(s.tenants.id, ctx.tenantId), sql`${s.tenants.id} = app.current_tenant_id()`));
      // Turning the assistant off clears the company's knowledge index (ADR 0026); turning it on
      // again rebuilds it from scratch.
      if (!body.enabled) await tx.delete(s.knowledgeChunks);
      await this.db.audit(tx, ctx, {
        action: 'ai_settings.updated',
        subjectType: 'tenant',
        subjectId: ctx.tenantId,
        before: { ...before },
        after: { ...body },
      });
      return body;
    });
  }

  async breakdown(
    ctx: TenantContext,
    body: TaskBreakdownRequest,
    signal?: AbortSignal,
  ): Promise<TaskBreakdownResponse> {
    const prepared = await this.db.run(ctx, async (tx) => {
      if (!(await loadAiSettings(tx, ctx.tenantId)).enabled) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'ai_disabled', 'The assistant is off');
      }
      const [department] = await tx
        .select({ id: s.departments.id, name: s.departments.name })
        .from(s.departments)
        .where(eq(s.departments.id, body.departmentId));
      if (!department) throw notFound('Department');
      if (!canCreateIn(ctx.actor, department.id)) throw forbidden();
      const loaded = await loadWorkCalendar(tx, ctx.tenantId);
      return { department, loaded, today: calendarDateIn(new Date(), loaded.timeZone) };
    });
    if (!this.client.available) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'ai_unavailable', 'No AI service');
    }
    this.limiter.take(ctx.tenantId, ctx.memberId);
    // Only the sentence, the department's name and today: no people, no company data.
    const result = await this.client.taskBreakdown(
      {
        sentence: body.sentence,
        department: prepared.department.name.slice(0, 200),
        today: formatCalendarDate(prepared.today, 'full'),
      },
      signal,
    );
    return {
      tasks: result.tasks.slice(0, 10).map((task) => ({
        title: task.title.slice(0, 200),
        dueOn:
          task.dueInDays === null || task.dueInDays === undefined
            ? null
            : workingDayAfter(prepared.loaded.calendar, prepared.today, task.dueInDays),
      })),
    };
  }
}
