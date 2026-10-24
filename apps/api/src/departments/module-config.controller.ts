import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  applyTemplateRequest,
  saveConfigRequest,
  type ApplyTemplateRequest,
  type DepartmentConfig,
  type DepartmentConfigDetail,
  type SaveConfigRequest,
  type TemplateSummary,
} from '@madar/shared';

import { RequirePermission, Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ModuleConfigService } from './module-config.service.js';

/** Department templates and configs (plan phase-3-step-19a). */
@Controller()
export class ModuleConfigController {
  constructor(private readonly configs: ModuleConfigService) {}

  @Get('templates')
  @RequirePermission('department.read')
  templates(): TemplateSummary[] {
    return this.configs.templates();
  }

  @Get('module-configs')
  @RequirePermission('department.read')
  list(@Tenant() ctx: TenantContext): Promise<DepartmentConfig[]> {
    return this.configs.list(ctx);
  }

  @Get('departments/:id/config')
  @RequirePermission('department.read')
  detail(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartmentConfigDetail> {
    return this.configs.detail(ctx, id);
  }

  @Put('departments/:id/config')
  @RequirePermission('department.manage')
  save(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(saveConfigRequest)) body: SaveConfigRequest,
  ): Promise<DepartmentConfigDetail> {
    return this.configs.save(ctx, id, body);
  }

  @Post('departments/:id/apply-template')
  @RequirePermission('department.manage')
  applyTemplate(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(applyTemplateRequest)) body: ApplyTemplateRequest,
  ): Promise<DepartmentConfigDetail> {
    return this.configs.applyTemplate(ctx, id, body);
  }
}
