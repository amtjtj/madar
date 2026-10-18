import { Module } from '@nestjs/common';

import { RateLimitGuard } from '../common/rate-limit.js';
import { pushSenderProvider } from './push-sender.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

@Module({
  controllers: [PushController],
  providers: [PushService, pushSenderProvider, RateLimitGuard],
})
export class PushModule {}
