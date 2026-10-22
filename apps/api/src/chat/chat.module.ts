import { Module } from '@nestjs/common';

import { ChatExportService } from './chat-export.service.js';
import { ChatController, ConversationsController, MessagesController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

/** Internal chat (plans phase-2-step-15a to 15c, ADR 0022). */
@Module({
  controllers: [ConversationsController, MessagesController, ChatController],
  providers: [ChatService, ChatExportService],
})
export class ChatModule {}
