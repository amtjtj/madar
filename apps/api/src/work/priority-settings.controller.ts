import { Body, Controller, Get, Put } from '@nestjs/common';
import { schema as s } from '@madar/db';
import { priorityWeights, type PriorityWeights } from '@madar/shared';
import { and, eq, sql } from 'drizzle-orm';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TenantDb } from '../database/tenant-db.service.js';
import { loadPriorityWeights } from './ranking.js';

/** The company's priority weights (ADR 0017): everyone reads them, the owner changes them. */
@Controller('settings/priority')
export class PrioritySettingsController {
  constructor(private readonly db: TenantDb) {}

  @Get()
  get(@Tenant() ctx: TenantContext): Promise<PriorityWeights> {
    return this.db.run(ctx, (tx) => loadPriorityWeights(tx, ctx.tenantId));
  }

  @Put()
  @RequirePermission('tenant.manage')
  set(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(priorityWeights)) body: PriorityWeights,
  ): Promise<PriorityWeights> {
    return this.db.run(ctx, async (tx) => {
      const before = await loadPriorityWeights(tx, ctx.tenantId);
      await tx
        .update(s.tenants)
        .set({
          settings: sql`${s.tenants.settings} || ${JSON.stringify({ priority: body })}::jsonb`,
        })
        // `tenants` is control-plane (no RLS): the session's tenant guards the row as well.
        .where(and(eq(s.tenants.id, ctx.tenantId), sql`${s.tenants.id} = app.current_tenant_id()`));
      await this.db.audit(tx, ctx, {
        action: 'priority_weights.updated',
        subjectType: 'tenant',
        subjectId: ctx.tenantId,
        before: before as unknown as Record<string, unknown>,
        after: body as unknown as Record<string, unknown>,
      });
      return body;
    });
  }
}
