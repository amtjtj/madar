import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import type { Auth } from './auth/auth.js';
import { requestLog } from './common/logging.js';
import type { Env } from './config/env.js';
import { RedisIoAdapter } from './realtime/redis-io.adapter.js';

/**
 * Shared HTTP setup for the real server and integration tests.
 * The app must be created with `{ bodyParser: false }`: Better Auth reads the raw body, so it is
 * mounted first and JSON parsing is enabled afterwards for everything else.
 */
export function configureApp(
  app: NestExpressApplication,
  env: Pick<Env, 'API_CORS_ORIGINS'> & Partial<Pick<Env, 'REDIS_URL'>>,
  auth?: Auth,
): void {
  const server = app.getHttpAdapter().getInstance();
  // Behind the web proxy / Caddy: trust loopback and private networks for the client IP.
  server.set('trust proxy', 'loopback, uniquelocal');
  server.use(requestLog);
  if (auth) server.all('/api/auth/{*path}', toNodeHandler(auth));
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // Realtime gateway (Socket.IO) shares rooms with the worker through Redis.
  if (env.REDIS_URL) app.useWebSocketAdapter(new RedisIoAdapter(app, env.REDIS_URL));
  if (env.API_CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: env.API_CORS_ORIGINS, credentials: true });
  }
}
