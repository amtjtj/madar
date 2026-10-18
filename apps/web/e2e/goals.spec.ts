import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

interface Period {
  id: string;
  current: boolean;
}

test('an employee sets a personal goal under the department goal, then records progress', async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { manager, employee, outsider } = await setUpCompany(baseURL ?? '');
  const periods = await ok<Period[]>(await manager.client.get('/api/goal-periods'));
  const period = periods.find((p) => p.current);
  const department = await ok<{ id: string }>(
    await manager.client.post('/api/goals', {
      data: {
        periodId: period?.id,
        level: 'department',
        title: 'پاسخ سریع‌تر به تیکت‌ها',
        keyResults: [{ title: 'میانگین زمان پاسخ', kind: 'number', startValue: 6, targetValue: 1 }],
      },
    }),
  );

  await signIn(page, employee.person.username, 'علی');
  await page.goto('/goals');
  await expect(page.getByText('هنوز هدفی برای این فصل نداری')).toBeVisible();

  // Create a goal with two key results; it should take seconds, not minutes.
  const started = Date.now();
  await page.getByRole('button', { name: 'هدف تازه' }).click();
  await page.getByLabel('هدف چیست؟').fill('یادگیری ابزار جدید پشتیبانی');
  await page.getByLabel('زیر کدام هدف؟').selectOption({ label: 'پاسخ سریع‌تر به تیکت‌ها' });
  await page.getByLabel('نتیجه کلیدی ۱', { exact: true }).fill('پاسخ آماده تازه');
  await page.getByRole('textbox', { name: /^تا/ }).fill('۲۰');
  await page.getByRole('button', { name: 'افزودن نتیجه کلیدی' }).click();
  await page.getByLabel('نتیجه کلیدی ۲', { exact: true }).fill('دوره آموزشی');
  await page.getByLabel('نوع').nth(1).selectOption('percent');
  await page.getByRole('button', { name: 'ساختن هدف' }).click();
  await expect(page.getByRole('heading', { name: 'یادگیری ابزار جدید پشتیبانی' })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);

  // Record progress: 10 of 20 is half way on that key result.
  await page.getByRole('button', { name: 'ثبت پیشرفت' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('عدد فعلی').fill('۱۰');
  await dialog.getByRole('radio', { name: 'در خطر' }).click();
  await dialog.getByLabel('یادداشت (اختیاری)').fill('نیمی از پاسخ‌ها آماده است');
  await dialog.getByRole('button', { name: 'ثبت' }).click();
  await expect(page.getByText('۱۰ از ۲۰')).toBeVisible();
  // Goal: (0.5 + 0) / 2 = 25 %.
  await expect(page.getByRole('progressbar', { name: 'پیشرفت هدف' })).toHaveAttribute(
    'aria-valuenow',
    '25',
  );
  await page.getByRole('button', { name: 'تاریخچه پیشرفت' }).first().click();
  await expect(page.getByText('نیمی از پاسخ‌ها آماده است')).toBeVisible();

  // The department goal moved too, and it lists the personal goal.
  await page.getByRole('link', { name: 'پاسخ سریع‌تر به تیکت‌ها' }).first().click();
  await expect(page.getByRole('heading', { name: 'هدف‌های زیرمجموعه' })).toBeVisible();
  await expect(page.getByRole('link', { name: /یادگیری ابزار جدید پشتیبانی/ })).toBeVisible();

  // A marketer sees neither the department goal nor the personal one.
  const theirs = await ok<Array<{ id: string }>>(
    await outsider.client.get('/api/goals?view=company'),
  );
  expect(theirs.map((g) => g.id)).not.toContain(department.id);
});

test('the company tab shows the alignment tree, and a task can serve a key result', async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  const periods = await ok<Period[]>(await manager.client.get('/api/goal-periods'));
  const periodId = periods.find((p) => p.current)?.id;
  const parent = await ok<{ id: string; keyResults: Array<{ id: string }> }>(
    await manager.client.post('/api/goals', {
      data: {
        periodId,
        level: 'department',
        title: 'تیکت معوق صفر',
        keyResults: [{ title: 'تیکت‌های معوق', kind: 'number', startValue: 50, targetValue: 0 }],
      },
    }),
  );
  await ok(
    await employee.client.post('/api/goals', {
      data: { periodId, level: 'individual', parentId: parent.id, title: 'هدف شخصی علی' },
    }),
  );
  const task = await ok<{ id: string }>(
    await employee.client.post('/api/tasks', { data: { title: 'پاسخ به صف معوق' } }),
  );

  await signIn(page, manager.person.username, 'مریم');
  await page.goto('/goals');
  await page.getByRole('radio', { name: 'شرکت' }).click();
  const tree = page.getByRole('tree');
  await expect(tree.getByRole('link', { name: /تیکت معوق صفر/ })).toBeVisible();
  await expect(tree.getByRole('link', { name: /هدف شخصی علی/ })).toBeVisible();
  await tree.getByRole('button', { name: 'بستن زیرمجموعه‌های «تیکت معوق صفر»' }).click();
  await expect(tree.getByRole('link', { name: /هدف شخصی علی/ })).toBeHidden();

  await page.goto(`/tasks/${task.id}`);
  await page.getByLabel('نتیجه کلیدی').selectOption({ label: 'تیکت‌های معوق (تیکت معوق صفر)' });
  await expect(page.getByRole('link', { name: 'هدف: تیکت معوق صفر' })).toBeVisible();
  await page.getByRole('link', { name: 'هدف: تیکت معوق صفر' }).click();
  await expect(page.getByRole('link', { name: 'پاسخ به صف معوق' })).toBeVisible();
});
