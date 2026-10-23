import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import {
  aiSettings,
  taskBreakdownRequest,
  type AiSettings,
  type AiStatus,
  type TaskBreakdownRequest,
  type TaskBreakdownResponse,
} from '@madar/shared';
import type { Request } from 'express';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { RateLimit } from '../common/rate-limit.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AiService } from './ai.service.js';

/** The assistant (ADR 0025): status, the company switch and «جمله به کار». */
@Controller()
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('ai/status')
  status(@Tenant() ctx: TenantContext): Promise<AiStatus> {
    return this.ai.status(ctx);
  }

  @Get('ai/health')
  @RequirePermission('tenant.manage')
  health(): Promise<{ reachable: boolean; modelReachable: boolean }> {
    return this.ai.health();
  }

  @Put('settings/ai')
  @RequirePermission('tenant.manage')
  setSettings(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(aiSettings)) body: AiSettings,
  ): Promise<AiSettings> {
    return this.ai.setSettings(ctx, body);
  }

  @Post('ai/task-breakdown')
  @RateLimit({ max: 20, windowMs: 60_000 })
  breakdown(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(taskBreakdownRequest)) body: TaskBreakdownRequest,
    @Req() req: Request,
  ): Promise<TaskBreakdownResponse> {
    // A closed connection («لغو» on the page) stops waiting for the model.
    const aborted = new AbortController();
    req.res?.on('close', () => {
      if (!req.res?.writableFinished) aborted.abort();
    });
    return this.ai.breakdown(ctx, body, aborted.signal);
  }
}
