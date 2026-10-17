import next from '@madar/config/eslint/next';

// UI components follow the same React and RTL rules as the web app.
const config = [
  ...next,
  {
    rules: {
      // Not a Next.js app: no pages directory, and links come from the consumer.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];

export default config;
