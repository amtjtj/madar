import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults and parses CORS origins', () => {
    const env = loadEnv({
      APP_DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      AUTH_SECRET: 'x'.repeat(32),
      API_CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.API_CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('fails fast when APP_DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(/APP_DATABASE_URL/);
  });

  describe('in production', () => {
    const production = {
      NODE_ENV: 'production',
      APP_DATABASE_URL: 'postgres://madar_app:Xk3v9Qm2@postgres:5432/madar',
      WORKER_DATABASE_URL: 'postgres://madar_worker:Pq8w2Zr7@postgres:5432/madar',
      AUTH_SECRET: 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5',
      AUTH_BASE_URL: 'https://demo.madar.test',
      TENANT_SIGNUP_CODE: 'k2Hq8VbN4xZp',
    };

    it('starts with real secrets', () => {
      expect(loadEnv(production).DEMO_MODE).toBe(false);
      expect(loadEnv({ ...production, DEMO_MODE: 'true' }).DEMO_MODE).toBe(true);
    });

    it.each([
      ['AUTH_SECRET', { AUTH_SECRET: 'change-me-to-a-long-random-secret-at-least-32-chars' }],
      ['AUTH_BASE_URL', { AUTH_BASE_URL: 'http://demo.madar.test' }],
      ['TENANT_SIGNUP_CODE', { TENANT_SIGNUP_CODE: '' }],
      [
        'APP_DATABASE_URL',
        { APP_DATABASE_URL: 'postgres://madar_app:madar_app_dev_password@postgres:5432/madar' },
      ],
    ])('refuses a development value for %s', (key, override) => {
      expect(() => loadEnv({ ...production, ...override })).toThrow(new RegExp(key));
    });
  });
});
