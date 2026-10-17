import type { INestApplication } from '@nestjs/common';

import type { Env } from './config/env.js';

/** Shared HTTP setup for the real server and integration tests. */
export function configureApp(app: INestApplication, env: Pick<Env, 'API_CORS_ORIGINS'>): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  if (env.API_CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: env.API_CORS_ORIGINS, credentials: true });
  }
}
