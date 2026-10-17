import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
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
