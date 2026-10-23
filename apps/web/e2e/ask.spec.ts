import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

/** A word no other source in the company has, so the fake embedding finds only this task. */
const TITLE = 'تحویل گزارش زعفرانک به حسابداری';
const QUESTION = 'گزارش زعفرانک کجاست؟';

test('«از مدار بپرس» answers from what the person may see, with a source that opens', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { owner, manager, outsider } = await setUpCompany(baseURL ?? '');
  await ok(await owner.put('/api/settings/ai', { data: { enabled: true } }));
  const task = await ok<{ id: string }>(
    await manager.client.post('/api/tasks', { data: { title: TITLE } }),
  );

  // The worker indexes the company within a minute or two (its job runs every minute).
  await expect
    .poll(
      async () => {
        const status = await ok<{ pending: number; sources: { task: number } }>(
          await owner.get('/api/ai/index-status'),
        );
        return status.pending === 0 && status.sources.task > 0;
      },
      { timeout: 150_000, intervals: [2_000] },
    )
    .toBe(true);

  await signIn(page, manager.person.username, 'مریم');
  await page.goto('/ask');
  await expect(page.getByRole('heading', { name: 'از مدار بپرس', level: 1 })).toBeVisible();
  await page.getByRole('textbox', { name: 'سوال' }).fill(QUESTION);
  await page.getByRole('button', { name: 'بپرس', exact: true }).click();
  const answer = page.getByRole('region', { name: 'پاسخ دستیار' });
  await expect(answer.getByText('پیش‌نویس دستیار')).toBeVisible();
  await expect(answer.getByText(`پاسخ آزمایشی دستیار بر پایه «${TITLE}»`)).toBeVisible();
  // A follow-up keeps the conversation on the page.
  await page.getByRole('textbox', { name: 'سوال بعدی' }).fill('زعفرانک کی تحویل می‌شود؟');
  await page.getByRole('button', { name: 'بپرس', exact: true }).click();
  await expect(page.getByRole('region', { name: 'پاسخ دستیار' })).toHaveCount(2);
  await answer
    .first()
    .getByRole('link', { name: /تحویل گزارش زعفرانک/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}`));

  // Marketing cannot see a support task: nothing is found, and nothing is guessed.
  const other = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await signIn(other, outsider.person.username, 'شیوا');
  await other.goto('/ask');
  await other.getByRole('textbox', { name: 'سوال' }).fill(QUESTION);
  await other.getByRole('button', { name: 'بپرس', exact: true }).click();
  await expect(other.getByText('در چیزهایی که شما می‌بینید جوابی پیدا نکردم')).toBeVisible();

  // A question that ranks people is refused with an explanation.
  await other.getByRole('textbox', { name: 'سوال بعدی' }).fill('چه کسی از همه کمتر کار کرده؟');
  await other.getByRole('button', { name: 'بپرس', exact: true }).click();
  await expect(
    other.getByRole('alert').filter({ hasText: 'افراد را ارزیابی، مقایسه یا رتبه‌بندی نمی‌کند' }),
  ).toBeVisible();
  await other.close();
});
