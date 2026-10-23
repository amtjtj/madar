/**
 * Container healthcheck (plan phase-1-step-9 §6). `api`: the HTTP server answers and reaches the
 * database. `worker`: its heartbeat in Redis is fresh. `demo`: the daily reset loop is the
 * container's main process, so a running container is a healthy one (compose restarts it if the
 * loop dies); the check exists because `compose up --wait` refuses a service without one.
 * Exits 0 when healthy, 1 otherwise.
 */
import { Redis } from 'ioredis';

import { heartbeatKey } from '../health/heartbeat.js';

const mode = process.argv[2];

async function api(): Promise<boolean> {
  const port = process.env.API_PORT ?? '4000';
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(3_000),
  });
  const body = (await res.json()) as { dependencies?: { database?: string } };
  return res.ok && body.dependencies?.database === 'up';
}

async function worker(): Promise<boolean> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
  });
  try {
    await redis.connect();
    const beat = await redis.get(heartbeatKey(process.env.QUEUE_PREFIX ?? 'madar'));
    return beat !== null;
  } finally {
    redis.disconnect();
  }
}

const check = mode === 'worker' ? worker : mode === 'demo' ? () => Promise.resolve(true) : api;
check()
  .then((healthy) => process.exit(healthy ? 0 : 1))
  .catch(() => process.exit(1));
