import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

test('today, assignment, comments, board and department visibility', async ({
  page,
  baseURL,
}, testInfo) => {
  test.slow();
  const { manager, employee, outsider } = await setUpCompany(baseURL ?? '');
  await signIn(page, employee.person.username, 'علی');

  // Today: quick add, then complete it; the day's progress follows.
  await expect(page.getByText('هنوز کاری برای امروز نچیده‌ای')).toBeVisible();
  await page.getByLabel('کار تازه برای امروز').fill('ارسال گزارش روزانه');
  await page.keyboard.press('Enter');
  const todayTask = page.getByRole('checkbox', { name: /ارسال گزارش روزانه/ });
  await expect(todayTask).toBeVisible();
  await expect(page.getByText('۰ از ۱ کار امروز')).toBeVisible();
  await todayTask.click();
  await expect(page.getByText('۱ از ۱ کار امروز')).toBeVisible();
  await expect(page.getByText('همه کارهای امروز انجام شد!')).toBeVisible();

  // The manager assigns a task; it shows under «my tasks» and as a suggestion for today.
  const assigned = await ok<{ id: string }>(
    await manager.client.post('/api/tasks', {
      data: { title: 'پیگیری تیکت شماره ۴۲', assigneeId: employee.person.memberId },
    }),
  );
  await page.goto('/tasks');
  const card = page.getByRole('button', { name: 'پیگیری تیکت شماره ۴۲' });
  await expect(card).toBeVisible();

  // Comment on it.
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${assigned.id}`));
  await page.getByPlaceholder('نظرت را بنویس…').fill('شروع کردم؛ تا عصر تمام می‌شود.');
  await page.getByRole('button', { name: 'ارسال' }).click();
  await expect(page.getByText('شروع کردم؛ تا عصر تمام می‌شود.')).toBeVisible();

  // Board: move the card to «in progress» with the keyboard (same path as drag and drop).
  await page.goto('/tasks');
  await page.getByRole('radio', { name: 'برد' }).click();
  const todo = page.getByRole('region', { name: 'انجام‌نشده' });
  const doing = page.getByRole('region', { name: 'در حال انجام' });
  await expect(todo.getByText('پیگیری تیکت شماره ۴۲')).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    const draggable = todo
      .locator('[aria-roledescription]')
      .filter({ hasText: 'پیگیری تیکت شماره ۴۲' });
    await draggable.focus();
    // Wait for each screen-reader announcement, as a keyboard user would.
    const live = page.locator('[aria-live]');
    await page.keyboard.press('Space');
    await expect(draggable).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(live.filter({ hasText: 'انتقال به در حال انجام' })).toHaveCount(1);
    await page.keyboard.press('Space');
    await expect(doing.getByText('پیگیری تیکت شماره ۴۲')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await ok<{ statusKey: string }>(await employee.client.get(`/api/tasks/${assigned.id}`)))
            .statusKey,
      )
      .toBe('in_progress');
  }

  // Someone in another department cannot see it.
  expect((await outsider.client.get(`/api/tasks/${assigned.id}`)).status()).toBe(404);
  const outsiderList = await ok<Array<{ id: string }>>(
    await outsider.client.get('/api/tasks?view=visible&status=all'),
  );
  expect(outsiderList.map((t) => t.id)).not.toContain(assigned.id);
});
