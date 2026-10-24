import { expect, test } from '@playwright/test';

import { addDays, calendarDateIn, persianWeekdayOfCalendarDate } from '@madar/shared';

import { ok, setUpCompany, signIn } from './company';

test('Ali asks for a day off and Maryam approves it; a reason comes back with a rejection', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { owner, manager, employee } = await setUpCompany(baseURL ?? '');

  // Ali: «درخواست تازه» → «مرخصی» → next Saturday, and he sees who gets it before sending.
  await signIn(page, employee.person.username, 'علی');
  await page.goto('/requests/new');
  await page.getByRole('button', { name: /^مرخصی/ }).click();
  await page.getByRole('button', { name: 'از', exact: true }).click();
  await page.getByRole('button', { name: 'شنبه بعد' }).click();
  await page.getByLabel('توضیح (اختیاری)').fill('مراسم خانوادگی');
  await expect(page.getByText('این درخواست به مریم احمدی می‌رسد.')).toBeVisible();
  await page.getByRole('button', { name: 'فرستادن' }).click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: /^مرخصی/ })).toBeVisible();
  await expect(page.getByText('در انتظار').first()).toBeVisible();
  const leaveId = page.url().split('/').at(-1) ?? '';

  // Maryam: the home card shows it; one tap approves it.
  const maryam = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(maryam, manager.person.username, 'مریم');
  await maryam.goto('/?tab=today');
  const card = maryam.getByRole('heading', { name: 'منتظر تایید تو' });
  await expect(card).toBeVisible();
  await maryam
    .getByRole('link', { name: /^مرخصی/ })
    .first()
    .click();
  await expect(maryam).toHaveURL(new RegExp(`/requests/${leaveId}$`));
  await maryam.getByRole('button', { name: 'تایید', exact: true }).click();
  await expect(maryam.getByText('تایید شد').first()).toBeVisible();
  await expect(maryam.getByRole('button', { name: 'تایید', exact: true })).toHaveCount(0);

  // The leave is on Ali's calendar that Saturday.
  let saturday = addDays(calendarDateIn(new Date(), 'Asia/Tehran'), 1);
  while (persianWeekdayOfCalendarDate(saturday) !== 0) saturday = addDays(saturday, 1);
  const range = await ok<{ days: Array<{ items: Array<{ kind: string }> }> }>(
    await employee.client.get(`/api/calendar?from=${saturday}&to=${saturday}&layers=leaves`),
  );
  expect(range.days[0]?.items.map((i) => i.kind)).toEqual(['leave']);

  // A general request: Maryam must say why she turns it down; Ali reads the reason.
  const general = await ok<{ id: string }>(
    await employee.client.post('/api/requests', {
      data: { kind: 'general', title: 'لپ‌تاپ دوم', data: { body: 'برای تست اپ موبایل' } },
    }),
  );
  await maryam.goto(`/requests/${general.id}`);
  await maryam.getByRole('button', { name: 'رد', exact: true }).click();
  const dialog = maryam.getByRole('dialog', { name: 'رد درخواست' });
  await expect(dialog.getByRole('button', { name: 'رد کن' })).toBeDisabled();
  await dialog.getByLabel('چرا رد می‌شود؟').fill('این فصل بودجه تجهیزات تمام شده');
  await dialog.getByRole('button', { name: 'رد کن' }).click();
  await expect(maryam.getByText('رد شد').first()).toBeVisible();
  await maryam.close();

  await page.goto('/requests?box=mine');
  await expect(page.getByRole('link', { name: /لپ‌تاپ دوم/ })).toBeVisible();
  await page.getByRole('link', { name: /لپ‌تاپ دوم/ }).click();
  await expect(page.getByText('این فصل بودجه تجهیزات تمام شده')).toBeVisible();

  // An expense over the threshold waits on the owner after Maryam.
  const expense = await ok<{ id: string; stepCount: number }>(
    await employee.client.post('/api/requests', {
      data: {
        kind: 'expense',
        data: { amountToman: 18_000_000, category: 'equipment', description: 'هدست شیفت شب' },
      },
    }),
  );
  expect(expense.stepCount).toBe(2);
  await ok(
    await manager.client.post(`/api/requests/${expense.id}/decide`, {
      data: { decision: 'approved' },
    }),
  );
  const pending = await ok<Array<{ id: string }>>(await owner.get('/api/requests?box=pending'));
  expect(pending.map((r) => r.id)).toContain(expense.id);
});
