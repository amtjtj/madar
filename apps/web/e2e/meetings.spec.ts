import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

test('schedule a meeting, record minutes, turn a decision into a task, cancel another', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { manager, employee, outsider } = await setUpCompany(baseURL ?? '');
  await signIn(page, manager.person.username, 'مریم');

  // The organizer schedules it from the screens.
  await page.goto('/meetings');
  await expect(page.getByText('جلسه پیش رویی نداری')).toBeVisible();
  await page.getByRole('button', { name: 'جلسه تازه' }).first().click();
  await expect(page.getByRole('heading', { name: 'جلسه تازه' })).toBeVisible();
  await page.getByLabel('عنوان', { exact: true }).fill('بررسی صف برداشت');
  await page.getByLabel('شرکت‌کنندگان', { exact: true }).fill('علی');
  await page.getByRole('button', { name: 'افزودن علی رضایی' }).click();
  await page.getByLabel('مکان', { exact: true }).fill('اتاق جلسه طبقه دوم');
  await page.getByRole('textbox', { name: 'دستور جلسه' }).fill('- صف امروز\n- تاخیرها');
  await page.getByRole('button', { name: 'ساختن جلسه' }).click();

  await expect(page.getByRole('heading', { name: 'بررسی صف برداشت' })).toBeVisible();
  await expect(page.getByText('اتاق جلسه طبقه دوم')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'تاخیرها' })).toBeVisible();
  const meetingId = page.url().split('/').at(-1) ?? '';

  // Ali is invited; the marketing colleague cannot open it.
  await expect
    .poll(async () => {
      const list = await ok<{ items: Array<{ kind: string; subjectId: string }> }>(
        await employee.client.get('/api/notifications'),
      );
      return list.items.some((n) => n.kind === 'meeting_invited' && n.subjectId === meetingId);
    })
    .toBe(true);
  expect((await outsider.client.get(`/api/meetings/${meetingId}`)).status()).toBe(404);

  // Minutes with a file.
  await page.getByRole('button', { name: 'نوشتن صورت‌جلسه' }).click();
  await page
    .getByRole('textbox', { name: 'صورت‌جلسه' })
    .fill('صف امروز بررسی شد؛ **دو برداشت** معطل ماند.');
  await page.locator('input[type=file]').setInputFiles({
    name: 'صورت‌جلسه.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(page.getByText('صورت‌جلسه.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'ثبت صورت‌جلسه' }).click();
  await expect(page.locator('strong', { hasText: 'دو برداشت' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ویرایش صورت‌جلسه' })).toBeVisible();

  // A decision becomes Ali's task, with source «meeting» and a link back.
  await page.getByLabel('افزودن مصوبه').fill('صف برداشت هر روز ساعت ۹ بررسی شود');
  await page.getByRole('button', { name: 'افزودن', exact: true }).click();
  await expect(page.getByText('صف برداشت هر روز ساعت ۹ بررسی شود')).toBeVisible();
  await page.getByRole('button', { name: 'تبدیل به کار' }).click();
  const dialog = page.getByRole('dialog', { name: 'تبدیل مصوبه به کار' });
  await expect(dialog.getByLabel('عنوان کار')).toHaveValue('صف برداشت هر روز ساعت ۹ بررسی شود');
  await dialog.getByLabel('مسئول').fill('علی');
  await dialog.getByRole('button', { name: 'افزودن علی رضایی' }).click();
  await dialog.getByRole('button', { name: 'ساختن کار' }).click();
  const taskLink = page.getByRole('link', { name: /کار: صف برداشت هر روز/ });
  await expect(taskLink).toBeVisible();
  await expect(page.getByText('(مسئول: علی رضایی)')).toBeVisible();
  await taskLink.click();
  await expect(page.getByRole('link', { name: 'از جلسه: بررسی صف برداشت' })).toBeVisible();

  // Ali sees today's meeting on his today screen, and the minutes.
  const soon = await ok<{ id: string }>(
    await manager.client.post('/api/meetings', {
      data: {
        type: 'regular',
        title: 'هماهنگی شیفت',
        startsAt: minutesFromNow(5),
        endsAt: minutesFromNow(35),
        participantIds: [employee.person.memberId],
      },
    }),
  );
  const ali = await browser.newPage();
  await signIn(ali, employee.person.username, 'علی');
  await ali.goto('/?tab=today');
  const card = ali.getByRole('link', { name: /هماهنگی شیفت/ });
  await expect(card).toBeVisible();
  await ali.goto(`/meetings/${meetingId}`);
  await expect(ali.locator('strong', { hasText: 'دو برداشت' })).toBeVisible();
  await expect(ali.getByRole('button', { name: 'ویرایش صورت‌جلسه' })).toBeVisible();

  // The organizer cancels the other one; Ali sees it struck out, read-only.
  await page.goto(`/meetings/${soon.id}`);
  await page.getByRole('button', { name: 'کارهای جلسه' }).click();
  await page.getByRole('menuitem', { name: 'لغو جلسه' }).click();
  await page
    .getByRole('dialog', { name: 'این جلسه لغو شود؟' })
    .getByRole('button', { name: 'لغو جلسه' })
    .click();
  await expect(page.getByText('این جلسه لغو شد و فقط برای خواندن باقی مانده است.')).toBeVisible();
  await ali.goto('/meetings');
  await expect(ali.getByRole('link', { name: /هماهنگی شیفت/ }).getByText('لغو شد')).toBeVisible();
  await ali.close();
});
