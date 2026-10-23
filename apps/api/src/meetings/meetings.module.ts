import { Module } from '@nestjs/common';

import { WorkModule } from '../work/work.module.js';
import { MeetingSeriesController, MeetingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';

/** Meetings, minutes and decisions (plan phase-2-step-13a, ADR 0023). */
@Module({
  imports: [WorkModule],
  controllers: [MeetingsController, MeetingSeriesController],
  providers: [MeetingsService],
})
export class MeetingsModule {}
