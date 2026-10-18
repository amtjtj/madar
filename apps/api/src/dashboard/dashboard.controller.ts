import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { CompanyDashboard, DepartmentDashboard } from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { DashboardService } from './dashboard.service.js';

/** Company: tenant-wide readers of work and goals. Department: its head and managers too. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('company')
  company(@Tenant() ctx: TenantContext): Promise<CompanyDashboard> {
    return this.dashboard.company(ctx);
  }

  @Get('departments/:id')
  department(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DepartmentDashboard> {
    return this.dashboard.department(ctx, id);
  }
}
