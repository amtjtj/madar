import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  gamificationSettings,
  giveKudosRequest,
  listKudosQuery,
  type GiveKudosRequest,
  type KudosAllowance,
  type KudosItem,
  type ListKudosQuery,
  type MemberProfile,
  type MyBadge,
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
import { KudosService } from './kudos.service.js';

/** XP, level and streak: my own only (plan phase-3-step-18a, ADR 0029). */
@Controller()
export class GamificationController {
  constructor(
    private readonly gamification: GamificationService,
    private readonly kudos: KudosService,
  ) {}

  @Post('kudos')
  give(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(giveKudosRequest)) body: GiveKudosRequest,
  ): Promise<KudosItem> {
    return this.kudos.give(ctx, body);
  }

  @Get('kudos')
  listKudos(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(listKudosQuery)) query: ListKudosQuery,
  ): Promise<KudosItem[]> {
    return this.kudos.list(ctx, query);
  }

  @Post('kudos/:id/hide')
  @HttpCode(204)
  hide(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.kudos.hide(ctx, id);
  }

  @Get('me/kudos-allowance')
  allowance(@Tenant() ctx: TenantContext): Promise<KudosAllowance> {
    return this.kudos.allowance(ctx);
  }

  @Get('me/badges')
  badges(@Tenant() ctx: TenantContext): Promise<MyBadge[]> {
    return this.kudos.myBadges(ctx);
  }

  @Get('members/:id/profile')
  profile(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MemberProfile> {
    return this.kudos.profile(ctx, id);
  }

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
