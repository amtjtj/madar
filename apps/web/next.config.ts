import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { NextConfig } from 'next';

// One .env for the whole monorepo (repo root). Real environment variables win.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  poweredByHeader: false,
  // In production Caddy routes /api/* to the API; in dev and e2e Next proxies it.
  // Note: rewrite destinations are resolved at build time, so `next start` uses the build-time URL.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
