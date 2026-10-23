import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn, signInOwner } from './company';

const SENTENCE = 'کمپین یلدا را راه بینداز';

test('the owner turns the assistant on; a manager turns a sentence into confirmed tasks', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { ownerLogin, manager, employee } = await setUpCompany(baseURL ?? '');

  // Off by default: no «پیشنهاد دستیار».
  await signIn(page, manager.person.username, 'مریم');
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'کارها', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'پیشنهاد دستیار' })).toHaveCount(0);

  // The owner turns it on in the company settings.
  const ownerPage = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signInOwner(ownerPage, ownerLogin);
  await ownerPage.goto('/org/assistant');
  await expect(ownerPage.getByText('سرویس دستیار روی این سرور نصب است.')).toBeVisible();
  await ownerPage.getByLabel('دستیار برای همه شرکت روشن باشد').check();
  await expect(ownerPage.getByText('دستیار روشن شد.').first()).toBeVisible();
  await ownerPage.close();

  // The manager asks, edits the suggestions and makes them.
  await page.reload();
  await page.getByRole('button', { name: 'پیشنهاد دستیار' }).click();
  const dialog = page.getByRole('dialog', { name: 'تقسیم یک هدف به کارها' });
  await dialog.getByLabel('چه کاری باید انجام شود؟').fill(SENTENCE);
  await dialog.getByRole('button', { name: 'پیشنهاد بده' }).click();
  const titles = dialog.getByRole('textbox', { name: 'عنوان کار' });
  await expect(titles).toHaveCount(4);
  await expect(titles.first()).toHaveValue(`برنامه‌ریزی: ${SENTENCE}`);

  await dialog.getByRole('button', { name: `حذف «اجرا: ${SENTENCE}»` }).click();
  await expect(titles).toHaveCount(3);
  await titles.first().fill('تعیین بودجه کمپین یلدا');
  await dialog.getByLabel('مسئول').nth(1).selectOption({ label: 'علی رضایی' });
  await dialog.getByRole('button', { name: 'ساختن ۳ کار' }).click();
  await expect(page.getByText('۳ کار ساخته شد.').first()).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // Made with the ordinary task endpoint: Ali has his, the manager has hers.
  await expect
    .poll(async () => {
      const list = await ok<Array<{ title: string }>>(
        await employee.client.get('/api/tasks?view=mine'),
      );
      return list.map((t) => t.title);
    })
    .toContain(`آماده‌سازی: ${SENTENCE}`);
  await page.goto('/tasks');
  await expect(page.getByText('تعیین بودجه کمپین یلدا').first()).toBeVisible();
});
