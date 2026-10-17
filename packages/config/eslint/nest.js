import globals from 'globals';
import tseslint from 'typescript-eslint';

import base from './base.js';

/** NestJS: decorators need value imports for DI metadata, so type-import enforcement is relaxed. */
export default tseslint.config(...base, {
  languageOptions: { globals: { ...globals.node } },
  rules: {
    '@typescript-eslint/consistent-type-imports': 'off',
    '@typescript-eslint/no-extraneous-class': 'off',
    // Database access goes through @madar/db (withTenant), never a raw driver (ADR 0002).
    'no-restricted-imports': [
      'error',
      {
        paths: [{ name: 'pg', message: 'Use @madar/db (withTenant) instead of the raw driver.' }],
        patterns: [
          {
            group: ['drizzle-orm/node-postgres', 'drizzle-orm/node-postgres/*'],
            message: 'Use @madar/db (withTenant) instead of creating connections.',
          },
        ],
      },
    ],
  },
});
