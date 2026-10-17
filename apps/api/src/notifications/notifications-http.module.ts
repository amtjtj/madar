import { Module } from '@nestjs/common';

import {
  NotificationPreferencesController,
  NotificationsController,
  WorkCalendarController,
} from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  controllers: [NotificationsController, NotificationPreferencesController, WorkCalendarController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
