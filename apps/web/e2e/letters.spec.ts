import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

test('write, send, refer, reply and read a letter; drafts come back; outsiders see nothing', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  // The marketing colleague gets a copy; «سینا» (added later) is on nothing.
  const {
    manager,
    employee,
    outsider: copied,
    support,
    createMember,
  } = await setUpCompany(baseURL ?? '');
  const expert = await createMember('رضا کریمی', support.id, 'member');
  await signIn(page, employee.person.username, 'علی');

  await page.goto('/letters');
  await expect(page.getByText('صندوق دریافتی خالی است')).toBeVisible();
  await page.getByRole('button', { name: 'نامه تازه' }).first().click();
  await expect(page.getByRole('heading', { name: 'نامه تازه' })).toBeVisible();

  // Recipients by name: «to» the manager, a copy to the marketing colleague.
  await page.getByLabel('گیرنده', { exact: true }).fill('مریم');
  await page.getByRole('button', { name: 'افزودن مریم احمدی' }).click();
  await page.getByLabel('رونوشت', { exact: true }).fill('شیوا');
  await page.getByRole('button', { name: 'افزودن شیوا کاظمی' }).click();
  await page.getByLabel('موضوع', { exact: true }).fill('پیگیری قرارداد پیمانکار');
  await page.getByLabel('فوریت', { exact: true }).selectOption('urgent');
  await page
    .getByRole('textbox', { name: 'متن نامه' })
    .fill('سلام،\n\nلطفاً قرارداد را **تا شنبه** بررسی کنید.\n\n- بند مبلغ\n- بند مدت');
  await page.getByRole('radio', { name: 'پیش‌نمایش' }).click();
  await expect(page.locator('strong', { hasText: 'تا شنبه' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'بند مدت' })).toBeVisible();
  await page.getByRole('radio', { name: 'نوشتن' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'قرارداد.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(page.getByText('قرارداد.pdf')).toBeVisible();

  // A short summary before sending.
  await page.getByRole('button', { name: 'ارسال', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'نامه فرستاده شود؟' });
  await expect(confirm.getByText('به: مریم احمدی')).toBeVisible();
  await expect(confirm.getByText('فوریت: فوری')).toBeVisible();
  await confirm.getByRole('button', { name: 'ارسال' }).click();

  await expect(page.getByRole('heading', { name: 'پیگیری قرارداد پیمانکار' })).toBeVisible();
  await expect(page.getByText(/^شماره:/)).toContainText(/۱۴۰[۰-۹]\/۰۰۰۰۱/);
  await expect(page.getByText('هنوز نخوانده').first()).toBeVisible();
  const letterId = page.url().split('/').at(-1) ?? '';

  // The manager is notified, opens it and refers it with a note; the expert replies.
  await expect
    .poll(async () => {
      const list = await ok<{ items: Array<{ kind: string; subjectId: string }> }>(
        await manager.client.get('/api/notifications'),
      );
      return list.items.some((n) => n.kind === 'letter_received' && n.subjectId === letterId);
    })
    .toBe(true);
  await ok(await manager.client.get(`/api/letters/${letterId}`));
  await ok(
    await manager.client.post(`/api/letters/${letterId}/refer`, {
      data: { memberIds: [expert.person.memberId], note: 'لطفاً بررسی و تا شنبه نظر بدهید' },
    }),
  );
  const reply = await ok<{ id: string }>(
    await expert.client.post('/api/letters', {
      data: {
        subject: 'پاسخ: پیگیری قرارداد پیمانکار',
        body: { format: 'lite', text: 'بررسی شد؛ بند مدت باید اصلاح شود.' },
        to: [employee.person.memberId],
        replyToId: letterId,
      },
    }),
  );
  await ok(await expert.client.post(`/api/letters/${reply.id}/send`));

  // Ali sees the read state, the referral route and the reply in the thread.
  await page.reload();
  await expect(page.getByText('خواند').first()).toBeVisible();
  const route = page.getByRole('region', { name: 'مسیر ارجاع' });
  await expect(route.getByText('مریم احمدی ← رضا کریمی')).toBeVisible();
  await expect(route.getByText('لطفاً بررسی و تا شنبه نظر بدهید')).toBeVisible();
  const thread = page.getByRole('region', { name: 'رشته نامه' });
  await thread.getByRole('link', { name: /پاسخ: پیگیری قرارداد پیمانکار/ }).click();
  await expect(page.getByText('بررسی شد؛ بند مدت باید اصلاح شود.')).toBeVisible();

  // The attached file reaches the people on the letter only.
  const files = await ok<{ attachments: Array<{ id: string }> }>(
    await manager.client.get(`/api/letters/${letterId}`),
  );
  const fileUrl = `/api/attachments/${files.attachments[0]?.id}/file`;
  expect((await manager.client.get(fileUrl)).status()).toBe(200);

  // Someone not on the letter gets «not found», for the letter and its file.
  const stranger = await createMember('سینا مرادی', support.id, 'manager');
  expect((await stranger.client.get(`/api/letters/${letterId}`)).status()).toBe(404);
  expect((await stranger.client.get(fileUrl)).status()).toBe(404);
  expect((await copied.client.get(`/api/letters/${letterId}`)).status()).toBe(200);
  const strangerPage = await (await browser.newContext({ baseURL })).newPage();
  await signIn(strangerPage, stranger.person.username, 'سینا');
  await strangerPage.goto(`/letters/${letterId}`);
  await expect(strangerPage.getByText('این نامه پیدا نشد یا دسترسی به آن نداری.')).toBeVisible();
  await strangerPage.context().close();

  // A draft is saved and opens again from «پیش‌نویس».
  await page.goto('/letters/new');
  await page.getByLabel('موضوع', { exact: true }).fill('گزارش ماهانه صف تیکت‌ها');
  await page.getByRole('button', { name: 'ذخیره پیش‌نویس' }).click();
  await expect(page.getByText('پیش‌نویس ذخیره شد').first()).toBeVisible();
  await page.goto('/letters?folder=drafts');
  await page.getByRole('link', { name: /گزارش ماهانه صف تیکت‌ها/ }).click();
  await expect(page.getByRole('heading', { name: 'ویرایش پیش‌نویس' })).toBeVisible();
  await expect(page.getByLabel('موضوع', { exact: true })).toHaveValue('گزارش ماهانه صف تیکت‌ها');
});
