import globals from 'globals';
import tseslint from 'typescript-eslint';

import base from './base.js';

/** NestJS: decorators need value imports for DI metadata, so type-import enforcement is relaxed. */
export default tseslint.config(...base, {
  languageOptions: { globals: { ...globals.node } },
  rules: {
    '@typescript-eslint/consistent-type-imports': 'off',
    '@typescript-eslint/no-extraneous-class': 'off',
  },
});
