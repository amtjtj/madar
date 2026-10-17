import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

// Integration tests use the repo-root .env (DATABASE_URL); they are skipped when it is absent.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  // Integration tests share one database with the API suites; allow for a busy machine.
  test: { include: ['src/**/*.test.ts'], hookTimeout: 60_000, testTimeout: 30_000 },
});
