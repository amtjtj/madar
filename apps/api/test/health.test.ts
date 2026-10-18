import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { healthResponse } from '@madar/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApp } from '../src/app.setup.js';
import { ConfigModule, ENV } from '../src/config/config.module.js';
import { DatabaseModule, DB_HANDLE } from '../src/database/database.module.js';
import { HEALTH_REDIS } from '../src/health/health.redis.js';
import { HealthModule } from '../src/health/health.module.js';

describe('GET /api/health', () => {
  let app: NestExpressApplication;
  let databaseUp = true;
  let redisUp = true;
  let heartbeat: string | null = String(Date.now());

  beforeAll(async () => {
    const fakePool = {
      query: () => (databaseUp ? Promise.resolve({ rows: [] }) : Promise.reject(new Error('down'))),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, HealthModule],
    })
      .overrideProvider(DB_HANDLE)
      .useValue({ pool: fakePool, close: () => Promise.resolve() })
      .overrideProvider(HEALTH_REDIS)
      .useValue({
        status: 'ready',
        get: () => (redisUp ? Promise.resolve(heartbeat) : Promise.reject(new Error('down'))),
        disconnect: () => undefined,
      })
      .overrideProvider(ENV)
      .useValue({ APP_VERSION: '9.9.9', QUEUE_PREFIX: 'test' })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app, { API_CORS_ORIGINS: [] });
    await app.init();
  });

  afterAll(() => app.close());

  it('reports ok when the database, Redis and the worker answer', async () => {
    databaseUp = true;
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    const body = healthResponse.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('9.9.9');
    expect(body.dependencies).toEqual({ database: 'up', redis: 'up', worker: 'up' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^[\w-]+$/);
  });

  it('reports degraded when the database is down', async () => {
    databaseUp = false;
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(healthResponse.parse(res.body).dependencies.database).toBe('down');
  });

  it('reports degraded without a worker heartbeat, or without Redis', async () => {
    databaseUp = true;
    heartbeat = null;
    let body = healthResponse.parse((await request(app.getHttpServer()).get('/api/health')).body);
    expect(body).toMatchObject({
      status: 'degraded',
      dependencies: { redis: 'up', worker: 'down' },
    });
    redisUp = false;
    body = healthResponse.parse((await request(app.getHttpServer()).get('/api/health')).body);
    expect(body.dependencies).toMatchObject({ redis: 'down', worker: 'down' });
    redisUp = true;
    heartbeat = String(Date.now());
  });

  it('keeps a safe request id from the proxy and replaces anything else', async () => {
    const kept = await request(app.getHttpServer())
      .get('/api/health')
      .set('X-Request-Id', 'abc-123');
    expect(kept.headers['x-request-id']).toBe('abc-123');
    const replaced = await request(app.getHttpServer())
      .get('/api/health')
      .set('X-Request-Id', 'bad id; with spaces');
    expect(replaced.headers['x-request-id']).not.toContain(' ');
  });
});
