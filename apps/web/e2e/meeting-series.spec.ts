import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

test('a weekly meeting: replies, a change for this and the following ones, minutes as evidence', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  await signIn(page, manager.person.username, 'مریم');

  // Weekly, from the form.
  await page.goto('/meetings/new');
  await page.getByLabel('عنوان', { exact: true }).fill('هماهنگی هفتگی پشتیبانی');
  await page.getByLabel('هر هفته تکرار شود').check();
  await expect(
    page.getByText(/^هر (شنبه|یکشنبه|دوشنبه|سه‌شنبه|چهارشنبه|پنجشنبه|جمعه)، ساعت/),
  ).toBeVisible();
  await page.getByLabel('شرکت‌کنندگان', { exact: true }).fill('علی');
  await page.getByRole('button', { name: 'افزودن علی رضایی' }).click();
  await page.getByRole('button', { name: 'ساختن جلسه' }).click();
  await expect(page.getByRole('heading', { name: 'هماهنگی هفتگی پشتیبانی' })).toBeVisible();
  await expect(page.getByText(/^هر هفته، .*‌ها، ساعت/)).toBeVisible();
  const firstId = page.url().split('/').at(-1) ?? '';

  // The coming weeks are in the list.
  await page.goto('/meetings');
  await expect
    .poll(async () => page.getByRole('link', { name: /هماهنگی هفتگی پشتیبانی/ }).count())
    .toBeGreaterThanOrEqual(4);

  // Ali declines the first meeting; Maryam sees it next to his name.
  const ali = await browser.newPage();
  await signIn(ali, employee.person.username, 'علی');
  await ali.goto(`/meetings/${firstId}`);
  await ali.getByRole('button', { name: 'نمی‌آیم' }).click();
  await expect(ali.getByRole('button', { name: 'نمی‌آیم' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(ali.getByText('پاسخت ثبت شد').first()).toBeVisible();
  await page.goto(`/meetings/${firstId}`);
  await expect(page.getByText(/۱ نفر می‌آیند، ۱ نفر نه/)).toBeVisible();

  // This and the following ones move to 10:00.
  await page.getByRole('button', { name: 'کارهای جلسه' }).click();
  await page.getByRole('menuitem', { name: 'ویرایش جلسه' }).click();
  await page.getByLabel('ساعت شروع').selectOption('10:00');
  await page.getByLabel('ساعت پایان').selectOption('10:30');
  await page.getByRole('button', { name: 'ذخیره' }).click();
  await page
    .getByRole('dialog', { name: 'کدام جلسه‌ها تغییر کنند؟' })
    .getByRole('button', { name: 'این و جلسه‌های بعدی' })
    .click();
  await expect(page.getByText(/ساعت ۱۰:۰۰ تا ۱۰:۳۰/).first()).toBeVisible();
  const nextId = page.url().split('/').at(-1) ?? '';

  // Ali writes the minutes and pins them to his task; the task shows the card.
  await ok(
    await employee.client.put(`/api/meetings/${nextId}/minutes`, {
      data: { body: 'صف برداشت بررسی شد؛ **دو مورد** ماند.', version: 0 },
    }),
  );
  const task = await ok<{ id: string }>(
    await employee.client.post('/api/tasks', { data: { title: 'پیگیری صف برداشت' } }),
  );
  await ali.goto(`/meetings/${nextId}`);
  await ali.getByRole('button', { name: 'سنجاق به کار' }).click();
  const dialog = ali.getByRole('dialog', { name: 'سنجاق این صورت‌جلسه به یک کار' });
  await dialog.getByRole('button', { name: 'انتخاب پیگیری صف برداشت' }).click();
  await expect(dialog.getByText(/نه شرکت‌کنندگان و مصوبه‌ها را/)).toBeVisible();
  await dialog.getByRole('button', { name: 'سنجاق', exact: true }).click();
  await expect(ali.getByText('صورت‌جلسه به‌عنوان شاهد سنجاق شد').first()).toBeVisible();
  await expect(ali.getByRole('button', { name: /سنجاق‌شده به ۱ کار/ })).toBeVisible();

  await ali.goto(`/tasks/${task.id}`);
  await ali.getByRole('button', { name: /دیدن صورت‌جلسه «هماهنگی هفتگی پشتیبانی»/ }).click();
  await expect(ali.locator('strong', { hasText: 'دو مورد' })).toBeVisible();
  await ali.close();
});
