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
  Put,
  Query,
} from '@nestjs/common';
import {
  createDepartmentRequest,
  setOversightRequest,
  updateDepartmentRequest,
  type CreateDepartmentRequest,
  type Department,
  type SetOversightRequest,
  type UpdateDepartmentRequest,
} from '@madar/shared';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DepartmentsService } from './departments.service.js';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermission('department.read')
  list(@Tenant() ctx: TenantContext, @Query('includeArchived') includeArchived?: string) {
    return this.departments.list(ctx, includeArchived === 'true');
  }

  @Post()
  @RequirePermission('department.manage')
  create(
    @Tenant() ctx: TenantContext,
    @Body(new ZodPipe(createDepartmentRequest)) body: CreateDepartmentRequest,
  ): Promise<Department> {
    return this.departments.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('department.manage')
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateDepartmentRequest)) body: UpdateDepartmentRequest,
  ): Promise<Department> {
    return this.departments.update(ctx, id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('department.manage')
  archive(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.departments.archive(ctx, id);
  }

  /** Owner only: which resources this department reads company-wide (ADR 0005). */
  @Put(':id/oversight')
  @RequirePermission('department.set_oversight')
  setOversight(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(setOversightRequest)) body: SetOversightRequest,
  ): Promise<Department> {
    return this.departments.setOversight(ctx, id, body);
  }
}
