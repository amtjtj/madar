import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

test('the manager tidies minutes with the assistant; an employee drafts a letter reply', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { owner, manager, employee } = await setUpCompany(baseURL ?? '');
  await ok(await owner.put('/api/settings/ai', { data: { enabled: true } }));
  const meeting = await ok<{ id: string }>(
    await manager.client.post('/api/meetings', {
      data: {
        type: 'regular',
        title: 'بررسی صف برداشت',
        startsAt: hoursFromNow(-2),
        endsAt: hoursFromNow(-1),
        participantIds: [employee.person.memberId],
      },
    }),
  );

  // Minutes: rough notes → tidy draft → replace, save, add a suggested decision.
  await signIn(page, manager.person.username, 'مریم');
  await page.goto(`/meetings/${meeting.id}`);
  await page.getByRole('button', { name: 'نوشتن صورت‌جلسه' }).click();
  await page
    .getByRole('textbox', { name: 'صورت‌جلسه' })
    .fill('صف زیاد بود. تا پنجشنبه با فنی هماهنگ شود');
  await page.getByRole('button', { name: 'مرتب کن با دستیار' }).click();
  const draft = page.getByRole('region', { name: 'صورت‌جلسه مرتب‌شده' });
  await expect(draft.getByText('پیش‌نویس دستیار')).toBeVisible();
  await draft.getByRole('button', { name: 'جایگزین متن' }).click();
  await expect(page.getByRole('textbox', { name: 'صورت‌جلسه' })).toHaveValue(
    /^خلاصه آزمایشی دستیار:/,
  );
  await draft.getByRole('button', { name: 'افزودن ۱ مصوبه' }).click();
  await expect(page.getByText('۱ مصوبه اضافه شد.').first()).toBeVisible();
  await page.getByRole('button', { name: 'ثبت صورت‌جلسه' }).click();
  await expect(page.getByRole('button', { name: 'ویرایش صورت‌جلسه' })).toBeVisible();
  const saved = await ok<{
    minutes: { body: string } | null;
    decisions: Array<{ text: string }>;
  }>(await manager.client.get(`/api/meetings/${meeting.id}`));
  expect(saved.minutes?.body).toContain('- تا پنجشنبه با فنی هماهنگ شود');
  expect(saved.decisions.map((d) => d.text)).toEqual(['تا پنجشنبه با فنی هماهنگ شود']);

  // A letter reply: the draft opens in the composer, marked, and the person sends it.
  const letter = await ok<{ id: string }>(
    await manager.client.post('/api/letters', {
      data: {
        subject: 'بودجه آبان',
        body: { format: 'lite', text: 'لطفاً برآورد هزینه را تا پنجشنبه بفرستید.' },
        to: [employee.person.memberId],
      },
    }),
  );
  await ok(await manager.client.post(`/api/letters/${letter.id}/send`));
  const other = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(other, employee.person.username, 'علی');
  await other.goto(`/letters/${letter.id}`);
  await other.getByRole('button', { name: 'پیش‌نویس پاسخ با دستیار' }).click();
  const dialog = other.getByRole('dialog', { name: 'پیش‌نویس پاسخ' });
  await dialog.getByLabel('منظور شما در یک جمله (اختیاری)').fill('تا آخر ماه می‌فرستم');
  await dialog.getByRole('button', { name: 'بنویس' }).click();
  await expect(other).toHaveURL(new RegExp(`/letters/new\\?replyTo=${letter.id}`));
  const body = other.getByRole('textbox', { name: 'متن نامه' });
  await expect(body).toHaveValue(/پاسخ آزمایشی دستیار به نامه «بودجه آبان»/);
  await expect(body).toHaveValue(/تا آخر ماه می‌فرستم/);
  await expect(other.getByText('پیش‌نویس دستیار').first()).toBeVisible();
  await other.close();
});
