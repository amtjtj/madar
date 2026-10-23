import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const flag = z
  .enum(['true', 'false', '1', '0', ''])
  .default('')
  .transform((value) => value === 'true' || value === '1');

/** Values that only belong in development, CI or the example file. */
const WEAK_SECRET = /change-me|ci-only|not-for-production/i;
const DEV_PASSWORD = /_dev_password|_ci_password/;

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
  /** Demo server (plan phase-1-step-9 §5): the demo company may be seeded and reset. */
  DEMO_MODE: flag,
  /** Password of every seeded demo account (compose passes DEMO_PASSWORD here). */
  SEED_PASSWORD: z.string().default(''),
  /** Where attachments live (ADR 0019): the server's disk (default) or an S3-compatible service. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** Folder for the local driver; empty means `.data/files` in the repo (development). */
  STORAGE_DIR: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  /** Most Iranian S3 services and MinIO want path-style addresses. */
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false', '1', '0', ''])
    .default('true')
    .transform((value) => value !== 'false' && value !== '0'),
  /** The AI service (ADR 0025) on the internal network; empty means the assistant is not installed. */
  AI_SERVICE_URL: z.string().default(''),
  /** Shared secret with the AI service. */
  AI_SERVICE_TOKEN: z.string().default(''),
  /** How long a call to the AI service may take (a 7B model on CPU is slow). */
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(90_000),
});

/** Production refuses to start with development defaults (plan phase-1-step-9 §4). */
const productionSchema = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  const fail = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (WEAK_SECRET.test(env.AUTH_SECRET)) fail('AUTH_SECRET', 'Use a random secret in production');
  if (!env.AUTH_BASE_URL.startsWith('https://')) {
    fail('AUTH_BASE_URL', 'Must be an https:// origin in production');
  }
  if (env.TENANT_SIGNUP_CODE.length < 12) {
    fail('TENANT_SIGNUP_CODE', 'Required in production (at least 12 characters)');
  }
  if (!env.WORKER_DATABASE_URL) fail('WORKER_DATABASE_URL', 'Required in production');
  if (env.DEMO_MODE && (env.SEED_PASSWORD.length < 12 || env.SEED_PASSWORD === 'madar-demo-1234')) {
    fail('SEED_PASSWORD', 'A demo server needs its own DEMO_PASSWORD (at least 12 characters)');
  }
  if (env.STORAGE_DRIVER === 'local' && !env.STORAGE_DIR) {
    fail('STORAGE_DIR', 'Required in production with the local file storage');
  }
  if (env.STORAGE_DRIVER === 's3') {
    for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
      if (!env[key]) fail(key, 'Required with STORAGE_DRIVER=s3');
    }
  }
  if (
    env.AI_SERVICE_URL &&
    (env.AI_SERVICE_TOKEN.length < 16 || WEAK_SECRET.test(env.AI_SERVICE_TOKEN))
  ) {
    fail(
      'AI_SERVICE_TOKEN',
      'Required with AI_SERVICE_URL (a random value, at least 16 characters)',
    );
  }
  for (const key of ['APP_DATABASE_URL', 'WORKER_DATABASE_URL'] as const) {
    if (env[key] && DEV_PASSWORD.test(env[key])) fail(key, 'Uses a development password');
  }
});

export type Env = z.infer<typeof productionSchema>;

/** Loads the repo-root .env (if present) without overriding real environment variables, then validates. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const rootEnv = resolve(import.meta.dirname, '../../../../.env');
  if (source === process.env && existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
  }
  const parsed = productionSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
