import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { ConsumerRunner } from './events/consumer-runner.service.js';
import { RelayService } from './events/relay.service.js';
import { SchedulerService } from './events/scheduler.service.js';
import { PushDeliveries } from './push/push-deliveries.service.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  app.get(ConsumerRunner).start();
  app.get(RelayService).start();
  app.get(PushDeliveries).start();
  await app.get(SchedulerService).start();
  Logger.log(
    'Worker started: outbox relay, consumers, push deliveries and scheduled jobs',
    'Bootstrap',
  );
}

void bootstrap();
