import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  await app.listen(env.API_PORT);
  Logger.log(`API listening on http://localhost:${env.API_PORT}/api`, 'Bootstrap');
}

void bootstrap();
