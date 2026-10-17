import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults and parses CORS origins', () => {
    const env = loadEnv({
      APP_DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      API_CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.API_CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('fails fast when APP_DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(/APP_DATABASE_URL/);
  });
});
