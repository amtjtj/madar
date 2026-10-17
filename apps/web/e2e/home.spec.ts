import { expect, test } from '@playwright/test';

test('home page is RTL Persian and shows live data from the API', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.getByRole('heading', { level: 1, name: 'مدار' })).toBeVisible();

  const result = page.getByTestId('health-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('سرور در دسترس است');
  await expect(result).toContainText('پایگاه داده');
});

test('layout has no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('health-result')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
