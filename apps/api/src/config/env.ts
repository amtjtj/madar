import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Application role: RLS applies (never the owner URL). */
  APP_DATABASE_URL: z.string().url(),
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
