import { expect, test } from '@playwright/test';

import { setUpCompany, signIn } from './company';

test('the app is installable: Persian RTL manifest with icons', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: 'مدار', lang: 'fa', dir: 'rtl', display: 'standalone' });
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
});

test('shows a calm offline page when the network is gone', async ({ page, context }) => {
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first load is not controlled by the worker yet; a reload is.
  await page.reload();
  // Controlled by a settled worker (no update installing in between).
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return Boolean(
          navigator.serviceWorker.controller &&
          registration.active?.state === 'activated' &&
          !registration.installing &&
          !registration.waiting,
        );
      }),
    )
    .toBe(true);

  await context.setOffline(true);
  // Under a busy test machine the worker can still be waking up for the first offline navigation;
  // a person would simply try again, so the navigation is retried (the page itself is not mocked).
  await expect(async () => {
    await page.goto('/tasks').catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'اتصال برقرار نیست' })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'دوباره تلاش کن' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await context.setOffline(false);
});

test('turns notifications on this device on and off; signing out removes them', async ({
  page,
  context,
  baseURL,
}) => {
  test.slow();
  const { employee } = await setUpCompany(baseURL ?? '');
  await context.grantPermissions(['notifications']);
  // No browser push service in tests: a stand-in PushManager keeps one fake subscription.
  await page.addInitScript(() => {
    const KEY = 'e2e-push-endpoint';
    const make = (endpoint: string) => ({
      endpoint,
      options: { applicationServerKey: null },
      toJSON: () => ({
        endpoint,
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
      }),
      unsubscribe: async () => {
        sessionStorage.removeItem(KEY);
        return true;
      },
    });
    PushManager.prototype.getSubscription = async function () {
      const endpoint = sessionStorage.getItem(KEY);
      return (endpoint ? make(endpoint) : null) as unknown as PushSubscription;
    };
    PushManager.prototype.subscribe = async function () {
      const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(KEY, endpoint);
      return make(endpoint) as unknown as PushSubscription;
    };
  });
  await signIn(page, employee.person.username, 'علی');
  await page.goto('/settings/notifications');

  await expect(page.getByRole('heading', { name: 'اعلان روی این دستگاه' })).toBeVisible();
  const subscribed = page.waitForResponse(
    (r) => r.url().endsWith('/api/push/subscriptions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'روشن کردن اعلان' }).click();
  expect((await subscribed).status()).toBe(204);
  await expect(page.getByRole('button', { name: 'ارسال اعلان آزمایشی' })).toBeVisible();

  await page.getByRole('button', { name: 'خاموش کردن' }).click();
  await expect(page.getByRole('button', { name: 'روشن کردن اعلان' })).toBeVisible();

  await page.getByRole('button', { name: 'روشن کردن اعلان' }).click();
  await expect(page.getByRole('button', { name: 'خاموش کردن' })).toBeVisible();
  const removed = page.waitForRequest(
    (r) => r.url().endsWith('/api/push/subscriptions') && r.method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'حساب کاربری' }).first().click();
  await page.getByRole('menuitem', { name: 'خروج' }).click();
  await removed;
  await expect(page).toHaveURL(/\/login/);
});
