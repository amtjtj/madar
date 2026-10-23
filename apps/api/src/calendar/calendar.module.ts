import { Module } from '@nestjs/common';

import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

/** The personal calendar (plan phase-2-step-14a, ADR 0024): no tables of its own. */
@Module({
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
