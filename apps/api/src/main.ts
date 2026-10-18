import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { productionLogger } from './common/logging.js';
import type { Auth } from './auth/auth.js';
import { AUTH } from './auth/auth.tokens.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: productionLogger(),
  });
  const env = app.get<Env>(ENV);
  configureApp(app, env, app.get<Auth>(AUTH));
  await app.listen(env.API_PORT);
  Logger.log(`API listening on http://localhost:${env.API_PORT}/api`, 'Bootstrap');
}

void bootstrap();
