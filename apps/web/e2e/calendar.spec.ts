import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
/** A calendar day in the company's time zone (the default, Tehran). */
const dayIn = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

test('my calendar: agenda, a day of the month, layers that stay off', async ({ page, baseURL }) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  const today = await ok<{ id: string }>(
    await employee.client.post('/api/tasks', {
      data: { title: 'پیگیری تیکت‌های امروز', dueOn: dayIn(0) },
    }),
  );
  await ok(
    await employee.client.post('/api/tasks', {
      data: { title: 'گزارش هفتگی صف', dueOn: dayIn(2) },
    }),
  );
  await ok(
    await manager.client.post('/api/meetings', {
      data: {
        type: 'regular',
        title: 'هماهنگی صف برداشت',
        startsAt: minutesFromNow(90),
        endsAt: minutesFromNow(120),
        participantIds: [employee.person.memberId],
      },
    }),
  );
  await signIn(page, employee.person.username, 'علی');

  // The agenda: today's task, the meeting and the task two days on.
  await page.goto('/calendar?view=agenda');
  await expect(page.getByRole('heading', { name: 'تقویم', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /پیگیری تیکت‌های امروز/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /گزارش هفتگی صف/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /هماهنگی صف برداشت/ })).toBeVisible();

  // Meetings off: hidden, and still hidden after a reload (this device remembers).
  await page.getByRole('button', { name: 'لایه‌ها' }).click();
  const dialog = page.getByRole('dialog', { name: 'لایه‌های تقویم' });
  await dialog.getByText('جلسه‌ها', { exact: true }).click();
  await expect(dialog.getByRole('switch', { name: 'جلسه‌ها' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: /هماهنگی صف برداشت/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('link', { name: /گزارش هفتگی صف/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /هماهنگی صف برداشت/ })).toHaveCount(0);

  // The month: today's cell opens the day (beside it on desktop, a sheet on phones).
  await page.goto('/calendar?view=month');
  await page.locator('button[aria-pressed="true"]').click();
  const item = page.getByRole('link', { name: /پیگیری تیکت‌های امروز/ });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${today.id}$`));
});
