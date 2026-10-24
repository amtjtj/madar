import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn, signInOwner } from './company';

interface Config {
  version: number;
  config: {
    fields: Array<{ key: string; label: string; options?: Array<{ key: string; label: string }> }>;
    workflows: Array<{ statuses: Array<{ key: string; label: string }> }>;
  };
}

test('an admin adds a status and a field without code; work uses them, and removal asks where work goes', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { owner, ownerLogin, support, employee } = await setUpCompany(baseURL ?? '');

  // The admin adds «منتظر مشتری» and a «کانال» choice field to the support department.
  await signInOwner(page, ownerLogin);
  await page.goto(`/departments/${support.id}/settings`);
  await expect(page.getByRole('heading', { level: 1, name: 'تنظیمات کار پشتیبانی' })).toBeVisible();
  await page.getByRole('button', { name: 'وضعیت تازه' }).click();
  await page.getByLabel('نام وضعیت').last().fill('منتظر مشتری');
  await page.getByRole('button', { name: 'فیلد تازه' }).click();
  await page.getByLabel('نام فیلد').last().fill('کانال');
  await page.getByLabel('نوع فیلد').last().selectOption('select');
  await page.getByPlaceholder('گزینه ۱').fill('تلفن');
  await page.getByRole('button', { name: 'گزینه تازه' }).click();
  await page.getByPlaceholder('گزینه ۲').fill('چت');
  await page.getByRole('checkbox', { name: 'کانال' }).check();
  await expect(page.getByText('تغییرهای ذخیره‌نشده داری.')).toBeVisible();
  await page.getByRole('button', { name: 'ذخیره تغییرها' }).click();
  await expect(page.getByText('تنظیمات ذخیره شد', { exact: true })).toBeVisible();

  // Ali makes a ticket with the new field and moves it to the new status from the task page.
  const detail = await ok<Config>(await owner.get(`/api/departments/${support.id}/config`));
  expect(detail.version).toBe(2);
  const channel = detail.config.fields.find((f) => f.label === 'کانال');
  const chat = channel?.options?.find((o) => o.label === 'چت');
  const task = await ok<{ id: string }>(
    await employee.client.post('/api/tasks', {
      data: {
        title: 'مشتری پاسخ تماس را نداده',
        typeKey: 'task',
        customFields: { [channel?.key ?? '']: chat?.key },
      },
    }),
  );
  const ali = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(ali, employee.person.username, 'علی');
  await ali.goto(`/tasks/${task.id}`);
  await expect(ali.getByRole('heading', { name: 'جزئیات' })).toBeVisible();
  await expect(ali.getByText('چت', { exact: true })).toBeVisible();
  await ali.getByLabel('وضعیت', { exact: true }).selectOption({ label: 'منتظر مشتری' });
  await expect(ali.getByText('ذخیره شد').first()).toBeVisible();

  // The department's board has a column for the new status, with the ticket in it.
  await ali.goto(`/tasks?view=department&departmentId=${support.id}`);
  await ali.getByRole('radio', { name: 'برد' }).click();
  const column = ali.getByRole('region', { name: 'منتظر مشتری' });
  await expect(column.getByText('مشتری پاسخ تماس را نداده')).toBeVisible();
  await ali.close();

  // Removing the status while work sits in it asks where that work goes.
  await page.reload();
  await page.getByRole('button', { name: 'حذف «منتظر مشتری»' }).click();
  await page.getByRole('button', { name: 'ذخیره تغییرها' }).click();
  const dialog = page.getByRole('dialog', { name: 'کارهای این‌ها کجا بروند؟' });
  await expect(dialog.getByLabel('«منتظر مشتری» (۱ کار) برود به')).toHaveValue('in_progress');
  await dialog.getByRole('button', { name: 'ذخیره و انتقال' }).click();
  await expect(page.getByText('تنظیمات ذخیره شد', { exact: true })).toBeVisible();
  const moved = await ok<{ statusKey: string }>(await employee.client.get(`/api/tasks/${task.id}`));
  expect(moved.statusKey).toBe('in_progress');
});
