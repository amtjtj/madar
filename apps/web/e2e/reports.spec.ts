import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

test('the CEO reads the weekly report and prints it without the app around it', async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { owner, manager, employee, createMember } = await setUpCompany(baseURL ?? '');
  const management = await ok<{ id: string }>(
    await owner.post('/api/departments', { data: { name: 'مدیریت' } }),
  );
  const ceo = await createMember('لیلا صادقی', management.id, 'member', ['executive', 'member']);
  for (const title of ['بستن تیکت‌های معوق', 'آموزش تیم شب']) {
    await ok(
      await manager.client.post('/api/tasks', {
        data: { title, assigneeId: employee.person.memberId, statusKey: 'done', weight: 4 },
      }),
    );
  }

  await signIn(page, ceo.person.username, 'لیلا');
  await page.getByRole('link', { name: 'گزارش هفته' }).click();
  await expect(page).toHaveURL(/\/reports\?scope=company/);
  await expect(page.getByRole('heading', { name: 'گزارش هفتگی' })).toBeVisible();
  await expect(page.getByText('هفته هنوز تمام نشده')).toBeVisible();
  const report = page.getByRole('article');
  await expect(report.getByText('کارهای انجام‌شده')).toBeVisible();
  await expect(report.getByRole('link', { name: 'بستن تیکت‌های معوق' })).toBeVisible();
  await expect(report.getByText(/علی رضایی/).first()).toBeVisible();

  // The PDF view: no navigation or controls, a print header with the company and the week.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'دریافت PDF' })).toBeHidden();
  await expect(page.getByRole('navigation').first()).toBeHidden();
  await expect(report.getByRole('heading', { name: /گزارش هفتگی زرین‌مدار/ })).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('a department manager only gets their own department report', async ({ page, baseURL }) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  await signIn(page, manager.person.username, 'مریم');
  await page.goto('/reports?scope=company');
  const scope = page.getByLabel('گزارش');
  await expect(scope).toHaveValue(/.+/);
  await expect(scope.locator('option')).toHaveText(['پشتیبانی']);
  await expect(page.getByRole('heading', { name: 'کارهای گیرکرده' })).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, employee.person.username, 'علی');
  await page.goto('/reports');
  await expect(page.getByText('هنوز گزارشی برای این هفته ثبت نشده است')).toBeVisible();
});
