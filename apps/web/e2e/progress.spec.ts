import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

test('record progress with a note, see it on the card and tell the manager', async ({
  page,
  baseURL,
}, testInfo) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  const task = await ok<{ id: string }>(
    await manager.client.post('/api/tasks', {
      data: { title: 'پیگیری قرارداد با واحد حقوقی', assigneeId: employee.person.memberId },
    }),
  );
  await signIn(page, employee.person.username, 'علی');
  await page.goto(`/tasks/${task.id}`);

  const slider = page.getByRole('slider', { name: 'درصد پیشرفت' });
  if (testInfo.project.name === 'desktop') {
    // Mouse: a click at 70 % of the track (0 is on the right in RTL).
    const box = await slider.boundingBox();
    if (!box) throw new Error('slider not laid out');
    await page.mouse.click(
      box.x + box.width - (22 + 0.7 * (box.width - 44)),
      box.y + box.height / 2,
    );
    await expect(slider).toHaveAttribute('aria-valuetext', '۷۰٪');
    await slider.press('Home');
  }
  // Keyboard: ten steps of five.
  await slider.focus();
  for (let i = 0; i < 10; i++) await slider.press('ArrowUp');
  await expect(slider).toHaveAttribute('aria-valuetext', '۵۰٪');
  await page.getByLabel('یادداشت کوتاه (اختیاری)').fill('تماس گرفتم، منتظر جوابم');
  await page.getByRole('button', { name: 'ثبت پیشرفت' }).click();
  await expect(page.getByText('علی رضایی پیشرفت را ۵۰٪ ثبت کرد')).toBeVisible();
  await expect(page.getByText('تماس گرفتم، منتظر جوابم')).toBeVisible();
  // The first progress starts the task.
  await expect(page.getByLabel('وضعیت')).toHaveValue('in_progress');

  // The card in the list shows a thin bar.
  await page.goto('/tasks');
  const card = page.getByRole('listitem').filter({ hasText: 'پیگیری قرارداد با واحد حقوقی' });
  await expect(card.getByRole('progressbar', { name: 'پیشرفت' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );

  // The manager who assigned it hears about it (the worker runs in e2e).
  await expect
    .poll(
      async () =>
        (
          await ok<{ items: Array<{ kind: string; subjectId: string }> }>(
            await manager.client.get('/api/notifications'),
          )
        ).items.some((n) => n.kind === 'task_progress' && n.subjectId === task.id),
      { timeout: 15_000 },
    )
    .toBe(true);

  // 100 % asks whether it is done.
  await page.goto(`/tasks/${task.id}`);
  await slider.focus();
  await slider.press('End');
  await page.getByRole('button', { name: 'ثبت پیشرفت' }).click();
  const dialog = page.getByRole('dialog', { name: 'انجام‌شده علامت بخورد؟' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'بله، انجام شد' }).click();
  await expect(page.getByLabel('وضعیت')).toHaveValue('done');
  await expect(slider).toHaveCount(0);
});

test('add someone from another department as an observer', async ({ page, baseURL }) => {
  test.slow();
  const { manager, outsider, support } = await setUpCompany(baseURL ?? '');
  const project = await ok<{ id: string }>(
    await manager.client.post('/api/projects', {
      data: { name: 'بازطراحی پاسخ‌های آماده', departmentId: support.id, visibility: 'private' },
    }),
  );
  await signIn(page, manager.person.username, 'مریم');
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'اعضا' }).click();
  const dialog = page.getByRole('dialog', { name: 'مدیریت اعضا' });
  await expect(dialog.getByText('هنوز کسی جز شما عضو این پروژه نیست.')).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'جست‌وجوی همکار' }).fill('شیوا');
  await dialog.getByRole('button', { name: 'افزودن شیوا کاظمی به پروژه' }).click();
  const role = dialog.getByLabel('نقش شیوا کاظمی');
  await expect(role).toHaveValue('member');
  await role.selectOption('observer');
  await expect(role).toHaveValue('observer');
  await page.keyboard.press('Escape');
  await expect(page.getByText('۱ ناظر')).toBeVisible();

  // The observer sees the private project but adds no work to it.
  const observerPage = await page.context().browser()?.newPage({ locale: 'fa-IR' });
  if (!observerPage) throw new Error('no browser');
  await observerPage.setViewportSize(page.viewportSize() ?? { width: 360, height: 780 });
  await signIn(observerPage, outsider.person.username, 'شیوا');
  await observerPage.goto(`/projects/${project.id}`);
  await expect(
    observerPage.getByRole('heading', { name: 'بازطراحی پاسخ‌های آماده' }),
  ).toBeVisible();
  await expect(observerPage.getByRole('button', { name: 'کار تازه' })).toHaveCount(0);
  await expect(observerPage.getByRole('button', { name: 'اعضا' })).toHaveCount(0);
  await observerPage.close();
});
