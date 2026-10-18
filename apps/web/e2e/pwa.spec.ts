import { expect, test } from '@playwright/test';

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
  await page.goto('/tasks').catch(() => undefined);
  await expect(page.getByRole('heading', { name: 'اتصال برقرار نیست' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'دوباره تلاش کن' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await context.setOffline(false);
});
