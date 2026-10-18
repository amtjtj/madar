import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Application role: RLS applies (never the owner URL). */
  APP_DATABASE_URL: z.string().url(),
  /** Worker role (ADR 0011): like the app role, plus the cross-tenant outbox functions. */
  WORKER_DATABASE_URL: z.string().url().optional(),
  API_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  APP_VERSION: z.string().default('0.0.0'),
  /** Secret for signing sessions and encrypting 2FA secrets (at least 32 characters). */
  AUTH_SECRET: z.string().min(32),
  /** Public origin the browser uses (the web app, which proxies /api). */
  AUTH_BASE_URL: z.string().url().default('http://localhost:3000'),
  /** Extra origins allowed to call auth endpoints (comma-separated). */
  AUTH_TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** Redis for queues (BullMQ) and realtime fan-out (Socket.IO adapter). */
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  /** Queue key prefix; tests use their own so parallel suites do not share jobs. */
  QUEUE_PREFIX: z.string().default('madar'),
  /** How often the worker polls the outbox when it is empty (ms). */
  RELAY_INTERVAL_MS: z.coerce.number().int().min(50).default(500),
  /** Web Push (VAPID) keys; without them device notifications are off. `pnpm --filter @madar/api vapid:generate`. */
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  /** Contact for push services (mailto: or https:); defaults to the public origin. */
  VAPID_SUBJECT: z.string().default(''),
  /** Outbound HTTP(S) proxy for push services, if the server needs one to reach them. */
  PUSH_PROXY_URL: z.string().default(''),
  /** Notifications within this window go out as one push (ms). */
  PUSH_BATCH_MS: z.coerce.number().int().min(0).default(10_000),
  /** Required to register a company in production; empty means signup is open (development). */
  TENANT_SIGNUP_CODE: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

/** Loads the repo-root .env (if present) without overriding real environment variables, then validates. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const rootEnv = resolve(import.meta.dirname, '../../../../.env');
  if (source === process.env && existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
