import { Module } from '@nestjs/common';

import { GamificationController } from './gamification.controller.js';
import { GamificationService } from './gamification.service.js';
import { KudosService } from './kudos.service.js';

/** XP, levels and streaks (plan phase-3-step-18a, ADR 0029); the worker part is in events. */
@Module({
  controllers: [GamificationController],
  providers: [GamificationService, KudosService],
})
export class GamificationModule {}
