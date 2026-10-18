import { expect, test, type Page } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

/** The bell's accessible name carries the unread count. */
const bell = (page: Page) => page.getByRole('button', { name: /^اعلان‌ها/ }).first();

test('a new assignment rings the bell live, and opening it leads to the task', async ({
  page,
  baseURL,
}, testInfo) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  await signIn(page, employee.person.username, 'علی');
  await expect(bell(page)).toHaveAccessibleName('اعلان‌ها');

  const task = await ok<{ id: string }>(
    await manager.client.post('/api/tasks', {
      data: { title: 'بررسی فوری تراکنش ۷۷', assigneeId: employee.person.memberId },
    }),
  );
  // No reload: the worker creates the notification and the socket hint refreshes the counter.
  await expect(bell(page)).toHaveAccessibleName('اعلان‌ها، ۱ خوانده‌نشده', { timeout: 15_000 });

  await bell(page).click();
  if (testInfo.project.name === 'mobile') await expect(page).toHaveURL(/\/notifications$/);
  await page
    .getByRole('button', { name: /مریم احمدی کار «بررسی فوری تراکنش ۷۷» را به تو سپرد/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}`));
  await expect(bell(page)).toHaveAccessibleName('اعلان‌ها');
});

test('the board updates live when a teammate adds a task', async ({ page, baseURL }) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  await signIn(page, employee.person.username, 'علی');
  await page.goto('/tasks');
  await page.getByRole('radio', { name: 'دپارتمان من' }).click();
  await page.getByRole('radio', { name: 'برد' }).click();
  await expect(page.getByRole('region', { name: 'انجام‌نشده' })).toBeVisible();

  await manager.client.post('/api/tasks', { data: { title: 'کار تازه تیم پشتیبانی' } });
  await expect(
    page.getByRole('region', { name: 'انجام‌نشده' }).getByText('کار تازه تیم پشتیبانی'),
  ).toBeVisible({ timeout: 15_000 });
});

test('muting a kind in settings stops those notifications', async ({ page, baseURL }) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  const task = await ok<{ id: string }>(
    await employee.client.post('/api/tasks', { data: { title: 'کار من' } }),
  );
  await signIn(page, employee.person.username, 'علی');
  await page.goto('/settings/notifications');
  const comments = page.getByRole('checkbox', { name: 'نظر تازه روی کارهایم' });
  await expect(comments).toBeChecked();
  await comments.click();
  await expect(comments).not.toBeChecked();
  await expect(page.getByText('تنظیمات اعلان ذخیره شد').first()).toBeVisible();

  await manager.client.post(`/api/tasks/${task.id}/comments`, { data: { body: 'سلام' } });
  // Give the worker time to (not) create it.
  await page.waitForTimeout(3000);
  const unread = await ok<{ unreadCount: number }>(
    await employee.client.get('/api/notifications/unread-count'),
  );
  expect(unread.unreadCount).toBe(0);
});
