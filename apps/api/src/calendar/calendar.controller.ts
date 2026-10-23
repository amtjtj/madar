import { Controller, Get, Query } from '@nestjs/common';
import { calendarQuery, type CalendarQuery, type CalendarRange } from '@madar/shared';

import { Tenant, type TenantContext } from '../common/context.js';
import { RateLimit } from '../common/rate-limit.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CalendarService } from './calendar.service.js';

/** The personal calendar (ADR 0024). */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RateLimit({ max: 120, windowMs: 60_000 })
  get(
    @Tenant() ctx: TenantContext,
    @Query(new ZodPipe(calendarQuery)) query: CalendarQuery,
  ): Promise<CalendarRange> {
    return this.calendar.get(ctx, query);
  }
}
