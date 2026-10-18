import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

const daysAgo = (days: number) => {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
};

test('the CEO lands on the company dashboard and drills into overdue work', async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { owner, support, manager, employee, createMember } = await setUpCompany(baseURL ?? '');
  const management = await ok<{ id: string }>(
    await owner.post('/api/departments', { data: { name: 'مدیریت' } }),
  );
  const ceo = await createMember('لیلا صادقی', management.id, 'member', ['executive', 'member']);
  for (const days of [2, 4]) {
    await ok(
      await manager.client.post('/api/tasks', {
        data: {
          title: `کار معوق ${days}`,
          assigneeId: employee.person.memberId,
          dueOn: daysAgo(days),
        },
      }),
    );
  }

  const started = Date.now();
  await signIn(page, ceo.person.username, 'لیلا');
  await expect(page.getByRole('radio', { name: 'شرکت' })).toHaveAttribute('aria-checked', 'true');
  const tile = page.getByRole('link', { name: /کارهای گذشته از سررسید/ });
  await expect(tile).toContainText('۲');
  expect(Date.now() - started).toBeLessThan(10_000);
  await tile.click();
  await expect(page).toHaveURL(/due=overdue/);
  await expect(page.getByText('گذشته از سررسید').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /کار معوق/ })).toHaveCount(2);

  // From the department row to that team's dashboard (a click, not a typed address).
  await page.goto('/');
  await page
    .getByRole('link', { name: /^پشتیبانی/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`department=${support.id}`));
  await expect(page.getByRole('radio', { name: 'تیم من' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('heading', { name: 'بار کاری تیم' })).toBeVisible();
  // Switching tabs keeps that department.
  await page.getByRole('radio', { name: 'شرکت' }).click();
  await page.getByRole('radio', { name: 'تیم من' }).click();
  await expect(page.getByRole('heading', { name: 'بار کاری تیم' })).toBeVisible();
  // People who might need help are for the team's own managers only.
  await expect(page.getByRole('heading', { name: 'شاید کمک لازم داشته باشند' })).toHaveCount(0);
});

test('a department manager lands on the team; an employee only sees Today', async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  for (const days of [2, 3, 4]) {
    await ok(
      await manager.client.post('/api/tasks', {
        data: {
          title: `عقب‌افتاده ${days}`,
          assigneeId: employee.person.memberId,
          dueOn: daysAgo(days),
        },
      }),
    );
  }

  await signIn(page, manager.person.username, 'مریم');
  await expect(page.getByRole('radio', { name: 'تیم من' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('heading', { name: 'شاید کمک لازم داشته باشند' })).toBeVisible();
  await expect(page.getByRole('link', { name: /علی رضایی.*۳ کار گذشته از سررسید/ })).toBeVisible();
  // The choice sticks: back on Today after picking it.
  await page.getByRole('radio', { name: 'امروز من' }).click();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'امروز من' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await page.context().clearCookies();
  await signIn(page, employee.person.username, 'علی');
  await expect(page.getByRole('radiogroup', { name: 'کدام نما' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'برنامه امروز' })).toBeVisible();
});
