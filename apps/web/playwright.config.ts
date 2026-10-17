import { defineConfig, devices } from '@playwright/test';

const apiPort = Number(process.env.E2E_API_PORT ?? 4100);
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @madar/api build && pnpm --filter @madar/api start',
      url: `http://localhost:${apiPort}/api/health`,
      // NODE_ENV=test turns off rate limits so repeated signups in e2e runs are not throttled.
      env: {
        API_PORT: String(apiPort),
        AUTH_BASE_URL: `http://localhost:${webPort}`,
        NODE_ENV: 'test',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Outbox relay and consumers (notifications, realtime), started once the API above is built and up.
      command: `until curl -sf http://localhost:${apiPort}/api/health > /dev/null; do sleep 1; done; pnpm --filter @madar/api worker`,
      wait: { stdout: /Worker started/ },
      env: { NODE_ENV: 'test' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm next dev --port ${webPort}`,
      url: `http://localhost:${webPort}`,
      env: { API_INTERNAL_URL: `http://localhost:${apiPort}` },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
