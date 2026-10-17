import { describe, expect, it } from 'vitest';

import { fetchHealth } from './api';

const validBody = {
  status: 'ok',
  service: 'madar-api',
  version: '0.0.0',
  time: new Date().toISOString(),
  dependencies: { database: 'up' },
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('fetchHealth', () => {
  it('returns the parsed health payload', async () => {
    await expect(fetchHealth(fakeFetch(200, validBody))).resolves.toEqual(validBody);
  });

  it('throws on HTTP errors', async () => {
    await expect(fetchHealth(fakeFetch(502, {}))).rejects.toThrow('HTTP 502');
  });

  it('throws when the payload breaks the contract', async () => {
    await expect(fetchHealth(fakeFetch(200, { status: 'ok' }))).rejects.toThrow();
  });
});
