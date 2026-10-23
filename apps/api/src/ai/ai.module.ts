import { Module } from '@nestjs/common';

import { AiClient } from './ai-client.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AskService } from './ask.service.js';

/** The assistant's HTTP side (ADR 0025); the summary job runs in the worker (EventsModule). */
@Module({
  controllers: [AiController],
  providers: [AiClient, AiService, AskService],
  exports: [AiClient],
})
export class AiModule {}
