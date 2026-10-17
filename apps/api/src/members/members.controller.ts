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
  auditLogQuery,
  createMemberRequest,
  updateMemberRequest,
  type AuditLogEntry,
  type AuditLogQuery,
  type CreateMemberRequest,
  type CreateMemberResponse,
  type Member,
  type OrgChartNode,
  type TemporaryPasswordResponse,
  type UpdateMemberRequest,
} from '@madar/shared';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { MembersService } from './members.service.js';

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('member.read')
  list(
    @Tenant() ctx: TenantContext,
    @Query('q') q?: string,
    @Query('departmentId', new ParseUUIDPipe({ optional: true })) departmentId?: string,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<Member[]> {
    return this.members.list(ctx, {
      q: q?.slice(0, 80),
      departmentId,
      includeInactive: includeInactive === 'true',
    });
  }

  @Get(':id')
  @RequirePermission('member.read')
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Member> {
    return this.members.get(ctx, id);
  }

  @Post()
  @RequirePermission('member.create')
  create(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(createMemberRequest)) body: CreateMemberRequest,
  ): Promise<CreateMemberResponse> {
    return this.members.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('member.update')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateMemberRequest)) body: UpdateMemberRequest,
  ): Promise<Member> {
    return this.members.update(ctx, id, body);
  }

  @Post(':id/reset-password')
  @RequirePermission('member.reset_credentials')
  resetPassword(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemporaryPasswordResponse> {
    return this.members.resetPassword(ctx, id);
  }

  @Post(':id/reset-2fa')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('member.reset_credentials')
  resetTwoFactor(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.members.resetTwoFactor(ctx, id);
  }

  @Post(':id/suspend')
  @RequirePermission('member.suspend')
  suspend(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Member> {
    return this.members.setStatus(ctx, id, 'suspended');
  }

  @Post(':id/activate')
  @RequirePermission('member.suspend')
  activate(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<Member> {
    return this.members.setStatus(ctx, id, 'active');
  }
}

@Controller('org-chart')
export class OrgChartController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('org_chart.read')
  get(@Tenant() ctx: TenantContext): Promise<OrgChartNode[]> {
    return this.members.orgChart(ctx);
  }
}

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('audit.read')
  list(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(auditLogQuery)) query: AuditLogQuery,
  ): Promise<AuditLogEntry[]> {
    return this.members.auditLog(ctx, query);
  }
}
