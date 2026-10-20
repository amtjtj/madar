import { Module } from '@nestjs/common';

import { ConversationsController, MessagesController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

/** Internal chat (plan phase-2-step-15a, ADR 0022). */
@Module({
  controllers: [ConversationsController, MessagesController],
  providers: [ChatService],
})
export class ChatModule {}
