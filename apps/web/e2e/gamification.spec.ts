import { expect, test } from '@playwright/test';

import { calendarDateIn } from '@madar/shared';

import { ok, setUpCompany, signIn } from './company';

test('Ali finishes his day: +XP on the check, the day completes, and only he sees his progress', async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { owner, manager, employee } = await setUpCompany(baseURL ?? '');
  const today = calendarDateIn(new Date(), 'Asia/Tehran');
  const task = await ok<{ id: string }>(
    await manager.client.post('/api/tasks', {
      data: {
        title: 'پاسخ به تیکت‌های صف شب',
        assigneeId: employee.person.memberId,
        weight: 3,
        dueOn: today,
      },
    }),
  );
  await ok(await employee.client.post(`/api/today/items/${task.id}`));

  await signIn(page, employee.person.username, 'علی');
  await page.goto('/?tab=today');
  const card = page.getByRole('link', { name: 'پیشرفت من: سطح، استریک و تاریخچه امتیاز' });
  await expect(card).toBeVisible();
  await expect(page.getByText('۰ از ۱ کار امروز؛ ۱ تای دیگر تا روز کامل.')).toBeVisible();

  // Weight 3, due today: 30 + 15 on time.
  await page
    .getByRole('checkbox', { name: /^پاسخ به تیکت‌های صف شب — علامت زدن/ })
    .first()
    .click();
  await expect(page.getByText('+۴۵ امتیاز').first()).toBeVisible();
  await expect(page.getByText('روزت کامل شد! استریک امروز حساب شد.')).toBeVisible();
  await expect(page.getByText('۵۵ امتیاز تا سطح بعد')).toBeVisible({ timeout: 15_000 });

  // «پیشرفت من»: the history names the work.
  await card.click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole('heading', { level: 1, name: 'پیشرفت من' })).toBeVisible();
  await expect(page.getByText('تمام کردن «پاسخ به تیکت‌های صف شب»')).toBeVisible();
  await expect(page.getByText('سر وقت «پاسخ به تیکت‌های صف شب»')).toBeVisible();
  await expect(page.getByRole('list', { name: 'روزهای اخیر' })).toBeVisible();

  // The manager has earned nothing from giving the work, and sees no one else's XP.
  const managerProgress = await ok<{ xp: number }>(await manager.client.get('/api/me/progress'));
  expect(managerProgress.xp).toBe(0);

  // The company switches it off: the card goes away.
  await ok(
    await owner.put('/api/settings/gamification', {
      data: { enabled: false, completeDayPercent: 70, dailyXpCap: 150 },
    }),
  );
  await page.goto('/?tab=today');
  await expect(page.getByRole('heading', { name: 'سلام علی' })).toBeVisible();
  await expect(card).toHaveCount(0);
});
