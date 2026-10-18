import { Module } from '@nestjs/common';

import { NotificationsConsumer } from './notifications.consumer.js';
import { Notifier } from './notifier.js';
import { WeeklyReportsJob } from '../reports/weekly-job.js';
import { RemindersService } from './reminders.service.js';

/** Notification creation shared by the worker (consumer, reminders) and the API. */
@Module({
  providers: [Notifier, NotificationsConsumer, RemindersService, WeeklyReportsJob],
  exports: [Notifier, NotificationsConsumer, RemindersService, WeeklyReportsJob],
})
export class NotificationsCoreModule {}
