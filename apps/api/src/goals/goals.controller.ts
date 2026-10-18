import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createCheckinRequest,
  createGoalRequest,
  keyResultOptionsQuery,
  listGoalsQuery,
  newKeyResultRequest,
  updateGoalRequest,
  updateKeyResultRequest,
  type Checkin,
  type CreateCheckinRequest,
  type CreateGoalRequest,
  type GoalDetail,
  type GoalPeriod,
  type GoalSummary,
  type KeyResult,
  type KeyResultOption,
  type ListGoalsQuery,
  type NewKeyResultRequest,
  type UpdateGoalRequest,
  type UpdateKeyResultRequest,
} from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { GoalsService } from './goals.service.js';
import { KeyResultsService } from './key-results.service.js';

/** Access is per goal (level, department, owner); see goals/access.ts. */
@Controller('goal-periods')
export class GoalPeriodsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  list(@Tenant() ctx: TenantContext): Promise<GoalPeriod[]> {
    return this.goals.periods(ctx);
  }
}

@Controller('goals')
export class GoalsController {
  constructor(
    private readonly goals: GoalsService,
    private readonly keyResults: KeyResultsService,
  ) {}

  @Get()
  list(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(listGoalsQuery)) query: ListGoalsQuery,
  ): Promise<GoalSummary[]> {
    return this.goals.list(ctx, query);
  }

  @Post()
  create(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(createGoalRequest)) body: CreateGoalRequest,
  ): Promise<GoalDetail> {
    return this.goals.create(ctx, body);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<GoalDetail> {
    return this.goals.get(ctx, id);
  }

  @Patch(':id')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateGoalRequest)) body: UpdateGoalRequest,
  ): Promise<GoalDetail> {
    return this.goals.update(ctx, id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.goals.archive(ctx, id);
  }

  @Post(':id/key-results')
  addKeyResult(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(newKeyResultRequest)) body: NewKeyResultRequest,
  ): Promise<KeyResult> {
    return this.keyResults.create(ctx, id, body);
  }
}

@Controller('key-results')
export class KeyResultsController {
  constructor(private readonly keyResults: KeyResultsService) {}

  @Get()
  options(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(keyResultOptionsQuery)) query: { q?: string },
  ): Promise<KeyResultOption[]> {
    return this.keyResults.options(ctx, query.q);
  }

  @Patch(':id')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateKeyResultRequest)) body: UpdateKeyResultRequest,
  ): Promise<KeyResult> {
    return this.keyResults.update(ctx, id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.keyResults.archive(ctx, id);
  }

  @Post(':id/check-ins')
  checkIn(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(createCheckinRequest)) body: CreateCheckinRequest,
  ): Promise<Checkin> {
    return this.keyResults.checkIn(ctx, id, body);
  }

  @Get(':id/check-ins')
  checkins(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Checkin[]> {
    return this.keyResults.checkins(ctx, id);
  }
}
