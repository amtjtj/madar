import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  reportWeeksQuery,
  type ReportRef,
  type ReportSummary,
  weeklyReportQuery,
  type ReportWeeksQuery,
  type WeeklyReport,
  type WeeklyReportQuery,
} from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ReportsService } from './reports.service.js';

@Controller('reports/weekly')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  weekly(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(weeklyReportQuery)) query: WeeklyReportQuery,
  ): Promise<WeeklyReport> {
    return this.reports.weekly(ctx, query);
  }

  @Get('summary')
  summary(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(weeklyReportQuery)) query: WeeklyReportQuery,
  ): Promise<ReportSummary> {
    return this.reports.summary(ctx, query);
  }

  @Get('weeks')
  weeks(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(reportWeeksQuery)) query: ReportWeeksQuery,
  ): Promise<string[]> {
    return this.reports.weeks(ctx, query);
  }

  @Get(':id/ref')
  ref(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string): Promise<ReportRef> {
    return this.reports.ref(ctx, id);
  }
}
