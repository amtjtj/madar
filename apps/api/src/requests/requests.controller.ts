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
  approvalSettings,
  createRequestRequest,
  decideRequestRequest,
  listRequestsQuery,
  routeQuery,
  type ApprovalSettings,
  type CreateRequestRequest,
  type DecideRequestRequest,
  type ListRequestsQuery,
  type RequestCounts,
  type RequestDetail,
  type RequestRoute,
  type RequestSummary,
  type RouteQuery,
} from '@madar/shared';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RequestsService } from './requests.service.js';

/** Requests and approvals (plan phase-3-step-17b, ADR 0028). */
@Controller()
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get('requests')
  list(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(listRequestsQuery)) query: ListRequestsQuery,
  ): Promise<RequestSummary[]> {
    return this.requests.list(ctx, query);
  }

  @Get('requests/counts')
  counts(@Tenant() ctx: TenantContext): Promise<RequestCounts> {
    return this.requests.counts(ctx);
  }

  @Get('requests/route')
  route(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(routeQuery)) query: RouteQuery,
  ): Promise<RequestRoute> {
    return this.requests.route(ctx, query.kind, query.amountToman);
  }

  @Post('requests')
  create(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(createRequestRequest)) body: CreateRequestRequest,
  ): Promise<RequestDetail> {
    return this.requests.create(ctx, body);
  }

  @Get('requests/:id')
  get(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RequestDetail> {
    return this.requests.get(ctx, id);
  }

  @Post('requests/:id/decide')
  @HttpCode(200)
  decide(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(decideRequestRequest)) body: DecideRequestRequest,
  ): Promise<RequestDetail> {
    return this.requests.decide(ctx, id, body);
  }

  @Post('requests/:id/cancel')
  @HttpCode(204)
  cancel(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.requests.cancel(ctx, id);
  }

  @Get('settings/approvals')
  settings(@Tenant() ctx: TenantContext): Promise<ApprovalSettings> {
    return this.requests.settings(ctx);
  }

  @Put('settings/approvals')
  @RequirePermission('tenant.manage')
  setSettings(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(approvalSettings)) body: ApprovalSettings,
  ): Promise<ApprovalSettings> {
    return this.requests.setSettings(ctx, body);
  }
}
