import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

interface Period {
  id: string;
  current: boolean;
}

test('the manager sets a personal goal and a sub-goal; the employee records progress', async ({
  page,
  browser,
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

  // Goals come from managers (plan phase-3-step-17a): Maryam sets Ali's goal, in seconds.
  await signIn(page, manager.person.username, 'مریم');
  await page.goto('/goals');
  const started = Date.now();
  await page.getByRole('button', { name: 'هدف تازه' }).click();
  await page.getByLabel('هدف چیست؟').fill('یادگیری ابزار جدید پشتیبانی');
  await page.getByLabel('سطح').selectOption({ label: 'هدف فردی' });
  await page.getByLabel('برای چه کسی؟').selectOption({ label: 'علی رضایی' });
  await page.getByLabel('زیر کدام هدف؟').selectOption({ label: 'پاسخ سریع‌تر به تیکت‌ها' });
  await page.getByLabel('نتیجه کلیدی ۱', { exact: true }).fill('پاسخ آماده تازه');
  await page.getByRole('textbox', { name: /^تا/ }).fill('۲۰');
  await page.getByRole('button', { name: 'افزودن نتیجه کلیدی' }).click();
  await page.getByLabel('نتیجه کلیدی ۲', { exact: true }).fill('دوره آموزشی');
  await page.getByLabel('نوع').nth(1).selectOption('percent');
  await page.getByRole('button', { name: 'ساختن هدف' }).click();
  await expect(page.getByRole('heading', { name: 'یادگیری ابزار جدید پشتیبانی' })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);

  // A department goal gets a sub-goal from its own page.
  await page.goto(`/goals/${department.id}`);
  await page.getByRole('button', { name: 'زیرهدف تازه' }).click();
  const sub = page.getByRole('dialog', { name: 'زیرهدف «پاسخ سریع‌تر به تیکت‌ها»' });
  await sub.getByLabel('هدف چیست؟').fill('پوشش شبانه صف');
  await sub.getByRole('button', { name: 'ساختن هدف' }).click();
  await expect(page.getByRole('heading', { name: 'پوشش شبانه صف' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'پاسخ سریع‌تر به تیکت‌ها' }).first()).toBeVisible();

  // Ali creates no goal and does not redefine his own, but records its progress.
  const ali = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(ali, employee.person.username, 'علی');
  await ali.goto('/goals');
  await expect(ali.getByRole('link', { name: /یادگیری ابزار جدید پشتیبانی/ })).toBeVisible();
  await expect(ali.getByRole('button', { name: 'هدف تازه' })).toHaveCount(0);
  await ali
    .getByRole('link', { name: /یادگیری ابزار جدید پشتیبانی/ })
    .first()
    .click();
  await expect(ali.getByRole('button', { name: 'نتیجه کلیدی تازه' })).toHaveCount(0);
  await ali.getByRole('button', { name: 'ثبت پیشرفت' }).first().click();
  const dialog = ali.getByRole('dialog');
  await dialog.getByLabel('عدد فعلی').fill('۱۰');
  await dialog.getByRole('radio', { name: 'در خطر' }).click();
  await dialog.getByLabel('یادداشت (اختیاری)').fill('نیمی از پاسخ‌ها آماده است');
  await dialog.getByRole('button', { name: 'ثبت' }).click();
  await expect(ali.getByText('۱۰ از ۲۰')).toBeVisible();
  // Goal: (0.5 + 0) / 2 = 25 %.
  await expect(ali.getByRole('progressbar', { name: 'پیشرفت هدف' })).toHaveAttribute(
    'aria-valuenow',
    '25',
  );
  await ali.getByRole('button', { name: 'تاریخچه پیشرفت' }).first().click();
  await expect(ali.getByText('نیمی از پاسخ‌ها آماده است')).toBeVisible();

  // The department goal lists the personal goal.
  await ali.getByRole('link', { name: 'پاسخ سریع‌تر به تیکت‌ها' }).first().click();
  await expect(ali.getByRole('heading', { name: 'هدف‌های زیرمجموعه' })).toBeVisible();
  await expect(ali.getByRole('link', { name: /یادگیری ابزار جدید پشتیبانی/ })).toBeVisible();
  await ali.close();

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
    await manager.client.post('/api/goals', {
      data: {
        periodId,
        level: 'individual',
        ownerId: employee.person.memberId,
        parentId: parent.id,
        title: 'هدف شخصی علی',
      },
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
