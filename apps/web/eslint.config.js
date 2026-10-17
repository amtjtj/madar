import next from '@madar/config/eslint/next';

const config = [
  ...next,
  {
    files: ['e2e/**'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
];

export default config;
