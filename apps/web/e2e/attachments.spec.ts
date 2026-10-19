import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNgYGD4z4AFMOAUAQA7ZQEFyBkiXQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

test('attach an image and a PDF to a task, preview, comment with a file, delete', async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { manager, employee, outsider } = await setUpCompany(baseURL ?? '');
  const task = await ok<{ id: string }>(
    await manager.client.post('/api/tasks', {
      data: { title: 'پیگیری قرارداد', assigneeId: employee.person.memberId },
    }),
  );
  await signIn(page, employee.person.username, 'علی');
  await page.goto(`/tasks/${task.id}`);

  const section = page.getByRole('region', { name: 'پیوست‌ها' });
  await expect(section.getByText('هنوز فایلی پیوست نشده')).toBeVisible();

  // The picker behind «افزودن فایل» (on phones it offers the camera too).
  await section.locator('input[type=file]').setInputFiles([
    { name: 'اسکن قرارداد.png', mimeType: 'image/png', buffer: PNG },
    { name: 'قرارداد نهایی.pdf', mimeType: 'application/pdf', buffer: PDF },
  ]);
  await expect(section.getByRole('button', { name: 'دیدن تصویر اسکن قرارداد.png' })).toBeVisible();
  const pdfLink = section.getByRole('link', { name: 'قرارداد نهایی.pdf', exact: true });
  await expect(pdfLink).toHaveAttribute('target', '_blank');
  await expect(
    page.getByText('علی رضایی فایل «اسکن قرارداد.png»، «قرارداد نهایی.pdf» را پیوست کرد'),
  ).toBeVisible();

  // Full-size image in the page.
  await section.getByRole('button', { name: 'دیدن تصویر اسکن قرارداد.png' }).click();
  const viewer = page.getByRole('dialog', { name: 'اسکن قرارداد.png' });
  await expect(viewer.getByRole('img', { name: 'اسکن قرارداد.png' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The PDF comes back as it went up; someone who cannot see the task gets nothing.
  const href = (await pdfLink.getAttribute('href')) ?? '';
  const download = await page.request.get(href);
  expect(download.headers()['content-type']).toBe('application/pdf');
  expect(Buffer.compare(await download.body(), PDF)).toBe(0);
  expect((await outsider.client.get(href)).status()).toBe(404);

  // Refused before upload: too large, or a type we do not take.
  await section.locator('input[type=file]').setInputFiles({
    name: 'setup.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('MZ'),
  });
  await expect(page.getByText('نوع فایل «setup.exe» پذیرفته نمی‌شود.').first()).toBeVisible();

  // A comment with a file.
  const comments = page.getByRole('region', { name: 'گفت‌وگو' });
  await comments.locator('input[type=file]').setInputFiles({
    name: 'نسخه اصلاح‌شده.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(comments.getByText('نسخه اصلاح‌شده.pdf')).toBeVisible();
  await comments.getByPlaceholder('نظرت را بنویس…').fill('این نسخه اصلاح‌شده است');
  await comments.getByRole('button', { name: 'ارسال' }).click();
  await expect(
    comments.getByRole('link', { name: 'نسخه اصلاح‌شده.pdf', exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole('link', { name: 'نسخه اصلاح‌شده.pdf', exact: true }),
  ).toBeVisible();

  // Delete, after a confirmation.
  await section.getByRole('button', { name: 'حذف قرارداد نهایی.pdf' }).click();
  await page
    .getByRole('dialog', { name: 'این فایل حذف شود؟' })
    .getByRole('button', { name: 'حذف' })
    .click();
  await expect(section.getByRole('link', { name: 'قرارداد نهایی.pdf', exact: true })).toHaveCount(
    0,
  );
  await expect.poll(async () => (await page.request.get(href)).status()).toBe(404);

  // The task card shows how many files it has.
  await page.goto('/tasks');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'پیگیری قرارداد' }).getByText('۲ پیوست'),
  ).toBeVisible();
});
