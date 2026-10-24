import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

test('Ali thanks Zahra for finished work; she reads it on her progress and earns a badge', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { manager, employee, support, createMember } = await setUpCompany(baseURL ?? '');
  const zahra = await createMember('زهرا محمدی', support.id, 'member');
  const task = await ok<{ id: string; version: number }>(
    await manager.client.post('/api/tasks', {
      data: { title: 'پوشش صف تیکت‌های فوری', assigneeId: zahra.person.memberId },
    }),
  );
  await ok(
    await zahra.client.patch(`/api/tasks/${task.id}`, {
      data: { statusKey: 'done', version: task.version },
    }),
  );

  // Ali opens the finished task and thanks Zahra.
  await signIn(page, employee.person.username, 'علی');
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole('button', { name: 'تشکر از زهرا محمدی' }).click();
  const dialog = page.getByRole('dialog', { name: 'تشکر از همکار' });
  await expect(dialog.getByText('این هفته ۵ تشکر دیگر داری')).toBeVisible();
  await dialog.getByRole('button', { name: 'همکاری' }).click();
  await dialog.getByLabel('یک خط بنویس').fill('دیشب صف را نجات دادی');
  await dialog.getByRole('button', { name: 'بفرست' }).click();
  await expect(page.getByText('تشکرت رسید.')).toBeVisible();

  // Zahra: on «پیشرفت من», the thanks and her first badge.
  const zahraPage = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(zahraPage, zahra.person.username, 'زهرا');
  await zahraPage.goto('/progress#kudos');
  await expect(zahraPage.getByText('دیشب صف را نجات دادی')).toBeVisible();
  await expect(zahraPage.getByText('علی رضایی به زهرا محمدی')).toBeVisible();
  await expect(zahraPage.getByRole('figure').filter({ hasText: 'اولین کار' })).toBeVisible();
  await expect(
    zahraPage.getByRole('figure').filter({ hasText: 'اولین کار' }).getByLabel('قفل'),
  ).toHaveCount(0);
  await zahraPage.close();

  // On Zahra's profile, colleagues see the thanks; Ali has four left this week.
  await page.goto(`/members/${zahra.person.memberId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'زهرا محمدی' })).toBeVisible();
  await expect(page.getByText('دیشب صف را نجات دادی')).toBeVisible();
  const allowance = await ok<{ left: number }>(
    await employee.client.get('/api/me/kudos-allowance'),
  );
  expect(allowance.left).toBe(4);
});
