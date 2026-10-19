import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  evidenceCandidatesQuery,
  pinEvidenceRequest,
  type Evidence,
  type EvidenceAudience,
  type EvidenceCandidatesQuery,
  type EvidenceDetail,
  type LetterSummary,
  type PinEvidenceRequest,
} from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { EvidenceService } from './evidence.service.js';

/** «شاهد کار» on a task (ADR 0021). Access is per task; pinning also needs the item itself. */
@Controller('tasks/:taskId/evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get()
  list(
    @Tenant() ctx: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<Evidence[]> {
    return this.evidence.list(ctx, taskId);
  }

  @Get('audience')
  audience(
    @Tenant() ctx: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<EvidenceAudience> {
    return this.evidence.audience(ctx, taskId);
  }

  @Get('candidates')
  candidates(
    @Tenant() ctx: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Query(new ZodPipe(evidenceCandidatesQuery)) query: EvidenceCandidatesQuery,
  ): Promise<LetterSummary[]> {
    return this.evidence.candidates(ctx, taskId, query.q);
  }

  @Post()
  pin(
    @Tenant() ctx: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body(new ZodPipe(pinEvidenceRequest)) body: PinEvidenceRequest,
  ): Promise<Evidence> {
    return this.evidence.pin(ctx, taskId, body);
  }

  @Get(':evidenceId')
  detail(
    @Tenant() ctx: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
  ): Promise<EvidenceDetail> {
    return this.evidence.detail(ctx, taskId, evidenceId);
  }

  @Delete(':evidenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unpin(
    @Tenant() ctx: TenantContext,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
  ): Promise<void> {
    return this.evidence.unpin(ctx, taskId, evidenceId);
  }
}
