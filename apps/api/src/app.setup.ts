import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import type { Auth } from './auth/auth.js';
import type { Env } from './config/env.js';

/**
 * Shared HTTP setup for the real server and integration tests.
 * The app must be created with `{ bodyParser: false }`: Better Auth reads the raw body, so it is
 * mounted first and JSON parsing is enabled afterwards for everything else.
 */
export function configureApp(
  app: NestExpressApplication,
  env: Pick<Env, 'API_CORS_ORIGINS'>,
  auth?: Auth,
): void {
  const server = app.getHttpAdapter().getInstance();
  // Behind the web proxy / Caddy: trust loopback and private networks for the client IP.
  server.set('trust proxy', 'loopback, uniquelocal');
  if (auth) server.all('/api/auth/{*path}', toNodeHandler(auth));
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  if (env.API_CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: env.API_CORS_ORIGINS, credentials: true });
  }
}
