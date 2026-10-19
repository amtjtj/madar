import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import { setTaskOrderRequest, type SetTaskOrderRequest } from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TasksService } from './tasks.service.js';

/** The signed-in member's own order of «my tasks» (ADR 0017); nobody else reads or changes it. */
@Controller('me/task-order')
export class TaskOrderController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  async get(@Tenant() ctx: TenantContext): Promise<{ taskIds: string[] }> {
    return { taskIds: await this.tasks.orderedIds(ctx) };
  }

  @Put()
  async set(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(setTaskOrderRequest)) body: SetTaskOrderRequest,
  ): Promise<{ taskIds: string[] }> {
    return { taskIds: await this.tasks.setOrder(ctx, body) };
  }

  @Delete()
  @HttpCode(204)
  clear(@Tenant() ctx: TenantContext): Promise<void> {
    return this.tasks.clearOrder(ctx);
  }
}
