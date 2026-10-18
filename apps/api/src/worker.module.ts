import { Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module.js';
import { WorkerDatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';

/** The worker process (ADR 0006): outbox relay, event consumers and scheduled jobs. No HTTP. */
@Module({ imports: [ConfigModule, WorkerDatabaseModule, EventsModule] })
export class WorkerModule {}
