import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  convertDecisionRequest,
  createMeetingRequest,
  decisionRequest,
  listMeetingsQuery,
  saveMinutesRequest,
  updateMeetingRequest,
  type ConvertDecisionRequest,
  type CreateMeetingRequest,
  type DecisionRequest,
  type ListMeetingsQuery,
  type Meeting,
  type MeetingList,
  type MeetingSummary,
  type SaveMinutesRequest,
  type Task,
  type UpdateMeetingRequest,
} from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { RateLimit } from '../common/rate-limit.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { MeetingsService } from './meetings.service.js';

/** Meetings, minutes and decisions (ADR 0023). Access is per meeting; see meetings/access.ts. */
@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(listMeetingsQuery)) query: ListMeetingsQuery,
  ): Promise<MeetingList> {
    return this.meetings.list(ctx, query);
  }

  @Get('today')
  today(@Tenant() ctx: TenantContext): Promise<MeetingSummary[]> {
    return this.meetings.today(ctx);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Meeting> {
    return this.meetings.get(ctx, id);
  }

  @Post()
  @RateLimit({ max: 30, windowMs: 3_600_000 })
  create(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(createMeetingRequest)) body: CreateMeetingRequest,
  ): Promise<Meeting> {
    return this.meetings.create(ctx, body);
  }

  @Patch(':id')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateMeetingRequest)) body: UpdateMeetingRequest,
  ): Promise<Meeting> {
    return this.meetings.update(ctx, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Meeting> {
    return this.meetings.cancel(ctx, id);
  }

  @Put(':id/minutes')
  saveMinutes(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(saveMinutesRequest)) body: SaveMinutesRequest,
  ): Promise<Meeting> {
    return this.meetings.saveMinutes(ctx, id, body);
  }

  @Post(':id/decisions')
  addDecision(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(decisionRequest)) body: DecisionRequest,
  ): Promise<Meeting> {
    return this.meetings.addDecision(ctx, id, body);
  }

  @Patch(':id/decisions/:decisionId')
  updateDecision(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
    @Body(new ZodPipe(decisionRequest)) body: DecisionRequest,
  ): Promise<Meeting> {
    return this.meetings.updateDecision(ctx, id, decisionId, body);
  }

  @Delete(':id/decisions/:decisionId')
  removeDecision(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
  ): Promise<Meeting> {
    return this.meetings.removeDecision(ctx, id, decisionId);
  }

  @Post(':id/decisions/:decisionId/task')
  convert(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
    @Body(new ZodPipe(convertDecisionRequest)) body: ConvertDecisionRequest,
  ): Promise<Task> {
    return this.meetings.convertDecision(ctx, id, decisionId, body);
  }
}
