import { describe, expect, it } from 'vitest';

import { healthResponse } from './health.js';

describe('healthResponse', () => {
  it('accepts a valid payload', () => {
    const payload = {
      status: 'ok',
      service: 'madar-api',
      version: '0.0.0',
      time: new Date().toISOString(),
      dependencies: { database: 'up', redis: 'up', worker: 'down' },
    };
    expect(healthResponse.parse(payload)).toEqual(payload);
  });

  it('rejects an unknown dependency status', () => {
    const result = healthResponse.safeParse({
      status: 'ok',
      service: 'madar-api',
      version: '0.0.0',
      time: new Date().toISOString(),
      dependencies: { database: 'maybe', redis: 'up', worker: 'up' },
    });
    expect(result.success).toBe(false);
  });
});
