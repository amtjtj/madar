import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { healthResponse } from '@madar/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApp } from '../src/app.setup.js';
import { ConfigModule, ENV } from '../src/config/config.module.js';
import { DatabaseModule, DB_HANDLE } from '../src/database/database.module.js';
import { HealthModule } from '../src/health/health.module.js';

describe('GET /api/health', () => {
  let app: INestApplication;
  let databaseUp = true;

  beforeAll(async () => {
    const fakePool = {
      query: () => (databaseUp ? Promise.resolve({ rows: [] }) : Promise.reject(new Error('down'))),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, HealthModule],
    })
      .overrideProvider(DB_HANDLE)
      .useValue({ pool: fakePool, close: () => Promise.resolve() })
      .overrideProvider(ENV)
      .useValue({ APP_VERSION: '9.9.9' })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, { API_CORS_ORIGINS: [] });
    await app.init();
  });

  afterAll(() => app.close());

  it('reports ok when the database answers', async () => {
    databaseUp = true;
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    const body = healthResponse.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe('9.9.9');
    expect(body.dependencies.database).toBe('up');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reports degraded when the database is down', async () => {
    databaseUp = false;
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(healthResponse.parse(res.body).dependencies.database).toBe('down');
  });
});
