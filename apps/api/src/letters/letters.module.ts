import { Module } from '@nestjs/common';

import { LettersController } from './letters.controller.js';
import { LettersService } from './letters.service.js';

/** Internal letters (plan phase-2-step-12a, ADR 0020). */
@Module({
  controllers: [LettersController],
  providers: [LettersService],
})
export class LettersModule {}
