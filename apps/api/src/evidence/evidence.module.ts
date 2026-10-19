import { Module } from '@nestjs/common';

import { WorkModule } from '../work/work.module.js';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';

/** «شاهد کار» (plan phase-2-step-12b, ADR 0021). */
@Module({
  imports: [WorkModule],
  controllers: [EvidenceController],
  providers: [EvidenceService],
})
export class EvidenceModule {}
