import { expect, test } from '@playwright/test';

test.describe('design system page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design-system');
  });

  test('renders every section with the self-hosted font', async ({ page }) => {
    for (const id of [
      'colors',
      'typography',
      'shape',
      'buttons',
      'inputs',
      'cards',
      'progress',
      'avatars',
      'badges',
      'skeleton',
      'empty',
      'feedback',
      'celebration',
      'navigation',
      'locale',
      'themes',
    ]) {
      await expect(page.locator(`section#${id}`)).toBeVisible();
    }
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font.toLowerCase()).toContain('vazirmatn');
  });

  test('has no horizontal overflow', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('theme toggle switches and persists the theme', async ({ page }) => {
    await page.getByRole('radio', { name: 'تیره' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('radio', { name: 'تیره' })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('radio', { name: 'سیستم' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('modal opens, traps focus and closes with Escape', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'باز کردن مودال' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'حذف این کار؟' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('toast appears with title and description', async ({ page }) => {
    await page.getByRole('button', { name: 'توست موفقیت' }).click();
    await expect(page.getByText('کار ثبت شد', { exact: true })).toBeVisible();
    await expect(page.getByText('به برنامه امروزت اضافه شد.', { exact: true })).toBeVisible();
  });

  test('completing a task updates the daily progress', async ({ page }) => {
    const section = page.locator('section#celebration');
    const progress = section.getByRole('progressbar', { name: 'برنامه امروز' });
    await expect(progress).toHaveAttribute('aria-valuenow', '33');
    const first = section.getByRole('checkbox').first();
    await first.click();
    await expect(first).toHaveAttribute('aria-checked', 'true');
    await expect(progress).toHaveAttribute('aria-valuenow', '67');
  });

  test('shows Jalali dates and Persian digits', async ({ page }) => {
    const locale = page.locator('section#locale');
    await expect(locale).toContainText(/۱۴۰[۰-۹]/);
    await expect(locale).toContainText('0912 345 6789 → ۰۹۱۲ ۳۴۵ ۶۷۸۹');
  });
});
