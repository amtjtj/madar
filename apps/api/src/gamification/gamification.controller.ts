import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import {
  gamificationSettings,
  listXpQuery,
  streakQuery,
  type GamificationSettings,
  type ListXpQuery,
  type MyProgress,
  type StreakDay,
  type StreakQuery,
  type XpEntry,
} from '@madar/shared';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { GamificationService } from './gamification.service.js';

/** XP, level and streak: my own only (plan phase-3-step-18a, ADR 0029). */
@Controller()
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Get('me/progress')
  progress(@Tenant() ctx: TenantContext): Promise<MyProgress> {
    return this.gamification.progress(ctx);
  }

  @Get('me/xp')
  xp(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(listXpQuery)) query: ListXpQuery,
  ): Promise<XpEntry[]> {
    return this.gamification.xp(ctx, query);
  }

  @Get('me/streak')
  streak(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(streakQuery)) query: StreakQuery,
  ): Promise<StreakDay[]> {
    return this.gamification.streak(ctx, query);
  }

  @Get('settings/gamification')
  settings(@Tenant() ctx: TenantContext): Promise<GamificationSettings> {
    return this.gamification.settings(ctx);
  }

  @Put('settings/gamification')
  @RequirePermission('tenant.manage')
  setSettings(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(gamificationSettings)) body: GamificationSettings,
  ): Promise<GamificationSettings> {
    return this.gamification.setSettings(ctx, body);
  }
}
