import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { setTodayItemsRequest, type SetTodayItemsRequest, type Today } from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TodayService } from './today.service.js';

/** The signed-in member's own plan for today; every response is the full, fresh plan. */
@Controller('today')
export class TodayController {
  constructor(private readonly today: TodayService) {}

  @Get()
  get(@Tenant() ctx: TenantContext): Promise<Today> {
    return this.today.get(ctx);
  }

  @Put('items')
  set(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(setTodayItemsRequest)) body: SetTodayItemsRequest,
  ): Promise<Today> {
    return this.today.set(ctx, body);
  }

  @Post('items/:taskId')
  add(
    @Tenant() ctx: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<Today> {
    return this.today.add(ctx, taskId);
  }

  @Delete('items/:taskId')
  remove(
    @Tenant() ctx: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<Today> {
    return this.today.remove(ctx, taskId);
  }
}
