import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata, which NestJS dependency injection needs.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['reflect-metadata'],
    // Integration suites sign up companies and members (scrypt password hashing). With the whole
    // monorepo testing at once, the default 10 s hook timeout tore apps down mid-request, which
    // surfaced as unrelated Better Auth session errors.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
