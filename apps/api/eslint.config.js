import nest from '@madar/config/eslint/nest';

const GAMIFICATION_TABLES = /^(xpLedger|streakDays|memberStats)$/;

export default [
  ...nest,
  {
    // XP and streaks stay inside the gamification module (ADR 0029): no report, dashboard,
    // export or assistant may read them, so they can never feed an evaluation.
    files: ['src/**/*.ts', 'test/**/*.ts'],
    ignores: ['src/gamification/**', 'src/scripts/**', 'test/gamification.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `MemberExpression[property.name=${String(GAMIFICATION_TABLES)}]`,
          message: 'Gamification tables are read and written only in src/gamification (ADR 0029).',
        },
      ],
    },
  },
  {
    // The future HR module never imports gamification (ADR 0007).
    files: ['src/hr/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'pg', message: 'Use @madar/db (withTenant) instead of the raw driver.' }],
          patterns: [
            {
              group: ['drizzle-orm/node-postgres', 'drizzle-orm/node-postgres/*'],
              message: 'Use @madar/db (withTenant) instead of creating connections.',
            },
            {
              group: ['**/gamification/**'],
              message: 'HR may not use gamification data (ADR 0007).',
            },
          ],
        },
      ],
    },
  },
];
