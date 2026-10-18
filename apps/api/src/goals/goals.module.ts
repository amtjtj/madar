import { Module } from '@nestjs/common';

import {
  GoalPeriodsController,
  GoalsController,
  KeyResultsController,
} from './goals.controller.js';
import { GoalsService } from './goals.service.js';
import { KeyResultsService } from './key-results.service.js';

@Module({
  controllers: [GoalPeriodsController, GoalsController, KeyResultsController],
  providers: [GoalsService, KeyResultsService],
  exports: [KeyResultsService],
})
export class GoalsModule {}
