import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

// The demo company from the seed; one sign-in per role (sign-ins are rate limited per IP).
const PASSWORD = process.env.SMOKE_PASSWORD ?? '';
const ROLES = {
  ceo: { username: 'leila.sadeghi', first: 'لیلا' },
  manager: { username: 'maryam.ahmadi', first: 'مریم' },
  employee: { username: 'ali.rezaei', first: 'علی' },
} as const;
type Role = keyof typeof ROLES;

// Saved sessions are shared by both viewports, so each role signs in once per run.
const AUTH_DIR = join(import.meta.dirname, '../test-results/.smoke-auth');
const sessionFile = (role: Role) => join(AUTH_DIR, `${role}.json`);

async function as(browser: Browser, role: Role): Promise<Page> {
  const saved = existsSync(sessionFile(role)) ? sessionFile(role) : undefined;
  const context = await browser.newContext({ storageState: saved });
  const page = await context.newPage();
  if (!saved) {
    const { username, first } = ROLES[role];
    await page.goto('/login');
    await page.getByLabel('نام کاربری').fill(username);
    await page.getByLabel(/^رمز عبور/).fill(PASSWORD);
    await page.getByRole('button', { name: 'ورود' }).click();
    await expect(page.getByRole('heading', { name: `سلام ${first}` })).toBeVisible();
    mkdirSync(AUTH_DIR, { recursive: true });
    await context.storageState({ path: sessionFile(role) });
  } else {
    await page.goto('/');
  }
  return page;
}

// With a real company's data (8 weeks of charts, long names) nothing may push the page sideways.
async function expectNoSidewaysScroll(page: Page) {
  await page.waitForLoadState('networkidle');
  const extra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(extra).toBeLessThanOrEqual(0);
}

test.beforeAll(() => {
  expect(PASSWORD, 'SMOKE_PASSWORD (the DEMO_PASSWORD) is required').not.toBe('');
});

test('the stack is healthy and installable over HTTPS', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({
    status: 'ok',
    dependencies: { database: 'up', redis: 'up', worker: 'up' },
  });
  const login = await request.get('/login');
  expect(login.headers()['strict-transport-security']).toContain('max-age=');
  expect(login.headers()['x-frame-options']).toBe('DENY');
  expect((await request.get('/manifest.webmanifest')).ok()).toBe(true);
  expect((await request.get('/sw.js')).headers()['content-type']).toContain('javascript');
});

test('each role lands on its home', async ({ browser }) => {
  const ceo = await as(browser, 'ceo');
  await expect(ceo.getByRole('radio', { name: 'شرکت' })).toHaveAttribute('aria-checked', 'true');
  await expect(ceo.getByRole('link', { name: /کارهای گذشته از سررسید/ })).toBeVisible();
  await expectNoSidewaysScroll(ceo);

  const manager = await as(browser, 'manager');
  await expect(manager.getByRole('radio', { name: 'تیم من' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expectNoSidewaysScroll(manager);

  const employee = await as(browser, 'employee');
  await expect(employee.getByRole('heading', { name: 'برنامه امروز' })).toBeVisible();
  await expectNoSidewaysScroll(employee);
});

test('a task assigned by the manager reaches the employee live (WebSocket through Caddy)', async ({
  browser,
}) => {
  const employee = await as(browser, 'employee');
  const socket = employee.waitForEvent('websocket', (ws) => ws.url().includes('/api/socket'));
  await employee.reload();
  const ws = await socket;
  // Socket.IO event frames start with 42; the server sends a data-free hint (ADR 0011).
  const hint = ws.waitForEvent('framereceived', {
    predicate: (frame) => String(frame.payload).startsWith('42'),
    timeout: 20_000,
  });

  const manager = await as(browser, 'manager');
  const members = (await (await manager.request.get('/api/members')).json()) as Array<{
    id: string;
    displayName: string;
  }>;
  const ali = members.find((m) => m.displayName === 'علی رضایی');
  expect(ali, 'seeded employee').toBeTruthy();
  const created = await manager.request.post('/api/tasks', {
    data: { title: `آزمون استقرار ${Date.now()}`, assigneeId: ali?.id },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBe(true);
  expect(String((await hint).payload)).toMatch(
    /work\.changed|today\.changed|notifications\.changed/,
  );
});

test('the weekly report opens and prints without the app around it', async ({ browser }) => {
  const ceo = await as(browser, 'ceo');
  await ceo.goto('/reports?scope=company');
  await expect(ceo.getByRole('article')).toBeVisible();
  await ceo.emulateMedia({ media: 'print' });
  await expect(ceo.getByRole('button', { name: 'دریافت PDF' })).toBeHidden();
});
