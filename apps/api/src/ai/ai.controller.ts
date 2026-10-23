import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import {
  aiSettings,
  askRequest,
  letterReplyDraftRequest,
  minutesDraftRequest,
  taskBreakdownRequest,
  type AiSettings,
  type AskRequest,
  type AskResponse,
  type KnowledgeIndexStatus,
  type LetterReplyDraftRequest,
  type LetterReplyDraftResponse,
  type MinutesDraftRequest,
  type MinutesDraftResponse,
  type AiStatus,
  type TaskBreakdownRequest,
  type TaskBreakdownResponse,
} from '@madar/shared';
import type { Request } from 'express';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { RateLimit } from '../common/rate-limit.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AiService } from './ai.service.js';
import { AskService } from './ask.service.js';
import { DraftsService } from './drafts.service.js';

/** Aborts when the caller goes away («لغو» on the page), so a slow model is not waited for. */
function abortOnClose(req: Request): AbortSignal {
  const aborted = new AbortController();
  req.res?.on('close', () => {
    if (!req.res?.writableFinished) aborted.abort();
  });
  return aborted.signal;
}

/** The assistant (ADR 0025, 0026): status, the company switch, «جمله به کار» and «از مدار بپرس». */
@Controller()
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly asking: AskService,
    private readonly drafts: DraftsService,
  ) {}

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

  @Post('ai/ask')
  // Per address (an office behind one NAT shares it); AskService also limits per person and company.
  @RateLimit({ max: 60, windowMs: 60_000 })
  ask(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(askRequest)) body: AskRequest,
    @Req() req: Request,
  ): Promise<AskResponse> {
    const aborted = new AbortController();
    req.res?.on('close', () => {
      if (!req.res?.writableFinished) aborted.abort();
    });
    return this.asking.ask(ctx, body, aborted.signal);
  }

  @Post('ai/minutes-draft')
  @RateLimit({ max: 20, windowMs: 60_000 })
  minutesDraft(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(minutesDraftRequest)) body: MinutesDraftRequest,
    @Req() req: Request,
  ): Promise<MinutesDraftResponse> {
    return this.drafts.minutes(ctx, body, abortOnClose(req));
  }

  @Post('ai/letter-reply')
  @RateLimit({ max: 20, windowMs: 60_000 })
  letterReply(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(letterReplyDraftRequest)) body: LetterReplyDraftRequest,
    @Req() req: Request,
  ): Promise<LetterReplyDraftResponse> {
    return this.drafts.letterReply(ctx, body, abortOnClose(req));
  }

  @Get('ai/index-status')
  @RequirePermission('tenant.manage')
  indexStatus(@Tenant() ctx: TenantContext): Promise<KnowledgeIndexStatus> {
    return this.asking.indexStatus(ctx);
  }
}
