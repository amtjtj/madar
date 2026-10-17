import { Module } from '@nestjs/common';

import { NotificationsConsumer } from './notifications.consumer.js';
import { Notifier } from './notifier.js';
import { RemindersService } from './reminders.service.js';

/** Notification creation shared by the worker (consumer, reminders) and the API. */
@Module({
  providers: [Notifier, NotificationsConsumer, RemindersService],
  exports: [Notifier, NotificationsConsumer, RemindersService],
})
export class NotificationsCoreModule {}
