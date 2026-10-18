import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test of a running production stack (scripts/deploy/smoke.sh, ADR 0016): no dev servers,
 * HTTPS through Caddy, the seeded demo company. SMOKE_HOST_IP maps the domain to an address when
 * the host cannot reach published ports (some sandboxes).
 */
const baseURL = process.env.SMOKE_BASE_URL ?? 'https://localhost';
const hostIp = process.env.SMOKE_HOST_IP;
const args = hostIp ? [`--host-resolver-rules=MAP ${new URL(baseURL).hostname} ${hostIp}`] : [];

export default defineConfig({
  testDir: './e2e-prod',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args,
    },
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
});
