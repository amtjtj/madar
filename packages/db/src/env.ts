import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the repo-root .env for scripts and tests (real environment variables win). */
export function loadRootEnv(): void {
  const rootEnv = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env at the repo root.`);
  return value;
}
