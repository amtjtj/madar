import { expect, test, type Page } from '@playwright/test';

import { ok, setUpCompany, signIn, signInOwner } from './company';

/** The chat link in the nav (sidebar on desktop, header on phones) carries the unread count. */
const chatLink = (page: Page) =>
  page.getByRole('link', { name: /^گفت‌وگوها/ }).filter({ visible: true });
const bell = (page: Page) => page.getByRole('button', { name: /^اعلان‌ها/ }).first();

test('project team chat: live message, reply, and a new project member gets the channel', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { manager, employee, outsider } = await setUpCompany(baseURL ?? '');
  const project = await ok<{ id: string }>(
    await manager.client.post('/api/projects', {
      data: { name: 'احراز هویت تازه', memberIds: [employee.person.memberId] },
    }),
  );

  await signIn(page, employee.person.username, 'علی');
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'گفت‌وگوی تیم' }).click();
  const view = page.getByRole('region', { name: 'احراز هویت تازه' });
  await expect(view.getByText('کانال پروژه')).toBeVisible();
  await expect(view.getByText('هنوز پیامی نیست؛ اولین پیام را بفرست.')).toBeVisible();

  // The manager writes; it shows up live without a reload.
  const channel = await ok<{ id: string }>(
    await manager.client.get(`/api/conversations/by-project/${project.id}`),
  );
  await ok(
    await manager.client.post(`/api/conversations/${channel.id}/messages`, {
      data: { body: 'سلام تیم، طرح فرم تازه در https://example.ir/kyc است.' },
    }),
  );
  await expect(view.getByText(/سلام تیم، طرح فرم تازه در/)).toBeVisible({ timeout: 15_000 });
  await expect(view.getByRole('link', { name: 'https://example.ir/kyc' })).toBeVisible();

  // Ali replies to it from the message menu.
  await view.getByRole('button', { name: 'کارهای پیام' }).first().click();
  await page.getByRole('menuitem', { name: 'پاسخ' }).click();
  await expect(view.getByText('پاسخ به مریم احمدی', { exact: false })).toBeVisible();
  await view.getByRole('textbox', { name: 'پیام بنویس…' }).fill('دیدم، امروز بررسی می‌کنم.');
  await view.getByRole('textbox', { name: 'پیام بنویس…' }).press('Enter');
  await expect(view.getByText('دیدم، امروز بررسی می‌کنم.')).toBeVisible();
  await expect(view.getByLabel('فرستاده شد').last()).toBeVisible();
  const page1 = await ok<{ items: Array<{ body: string; replyTo: { id: string } | null }> }>(
    await manager.client.get(`/api/conversations/${channel.id}/messages`),
  );
  expect(page1.items.at(-1)?.replyTo).not.toBeNull();

  // Adding someone to the project gives them the channel, with its history.
  const outsiderBefore = await outsider.client.get(`/api/conversations/${channel.id}`);
  expect(outsiderBefore.status()).toBe(404);
  await ok(
    await manager.client.put(`/api/projects/${project.id}/members`, {
      data: {
        members: [
          { memberId: manager.person.memberId, role: 'owner' },
          { memberId: employee.person.memberId, role: 'member' },
          { memberId: outsider.person.memberId, role: 'member' },
        ],
      },
    }),
  );
  const outsiderPage = await (await browser.newContext({ baseURL })).newPage();
  await signIn(outsiderPage, outsider.person.username, 'شیوا');
  await outsiderPage.goto('/chat');
  await outsiderPage.getByRole('link', { name: /احراز هویت تازه/ }).click();
  await expect(
    outsiderPage
      .getByRole('region', { name: 'احراز هویت تازه' })
      .getByText('دیدم، امروز بررسی می‌کنم.'),
  ).toBeVisible();
  await outsiderPage.context().close();
});

test('direct message: unread count and bell for the other person; edit and delete', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');

  const managerPage = await (await browser.newContext({ baseURL })).newPage();
  await signIn(managerPage, manager.person.username, 'مریم');
  await expect(chatLink(managerPage)).toHaveAccessibleName('گفت‌وگوها');

  await signIn(page, employee.person.username, 'علی');
  await page.goto('/chat');
  await page.getByRole('button', { name: 'گفت‌وگوی تازه' }).click();
  const dialog = page.getByRole('dialog', { name: 'گفت‌وگوی تازه' });
  await dialog.getByLabel('همکاران').fill('مریم');
  await dialog.getByRole('button', { name: 'افزودن مریم احمدی' }).click();
  const view = page.getByRole('region', { name: 'مریم احمدی' });
  await expect(view.getByText('گفت‌وگوی خصوصی')).toBeVisible();
  const box = view.getByRole('textbox', { name: 'پیام بنویس…' });
  await box.fill('گزارش صف را فرستادم');
  await box.press('Enter');
  await expect(view.getByText('گزارش صف را فرستادم')).toBeVisible();

  // Maryam sees one unread conversation and a notification, live.
  await expect(chatLink(managerPage)).toHaveAccessibleName(/^گفت‌وگوها،? ۱/, {
    timeout: 15_000,
  });
  await expect(bell(managerPage)).toHaveAccessibleName('اعلان‌ها، ۱ خوانده‌نشده', {
    timeout: 15_000,
  });

  // Ali fixes the message, then deletes it.
  await view.getByRole('button', { name: 'کارهای پیام' }).click();
  await page.getByRole('menuitem', { name: 'ویرایش' }).click();
  await expect(view.getByText('ویرایش پیام')).toBeVisible();
  await box.fill('گزارش صف هفته را فرستادم');
  await box.press('Enter');
  await expect(view.getByText('گزارش صف هفته را فرستادم')).toBeVisible();
  await expect(view.getByText('ویرایش‌شده')).toBeVisible();

  // Opening the conversation clears Maryam's unread count and the chat notification.
  await managerPage.goto('/chat');
  await managerPage.getByRole('link', { name: /علی رضایی/ }).click();
  const managerView = managerPage.getByRole('region', { name: 'علی رضایی' });
  await expect(managerView.getByText('گزارش صف هفته را فرستادم')).toBeVisible();
  await expect(chatLink(managerPage)).toHaveAccessibleName('گفت‌وگوها');
  await expect(bell(managerPage)).toHaveAccessibleName('اعلان‌ها');

  await view.getByRole('button', { name: 'کارهای پیام' }).click();
  await page.getByRole('menuitem', { name: 'حذف' }).click();
  await page
    .getByRole('dialog', { name: 'این پیام حذف شود؟' })
    .getByRole('button', { name: 'حذف' })
    .click();
  await expect(view.getByText('این پیام حذف شد')).toBeVisible();
  await expect(managerView.getByText('این پیام حذف شد')).toBeVisible({ timeout: 15_000 });
  await managerPage.context().close();
});

test('group: create, rename, and leave', async ({ page, baseURL }) => {
  test.slow();
  const { manager, employee, outsider } = await setUpCompany(baseURL ?? '');

  await signIn(page, manager.person.username, 'مریم');
  await page.goto('/chat');
  await page.getByRole('button', { name: 'گفت‌وگوی تازه' }).click();
  const dialog = page.getByRole('dialog', { name: 'گفت‌وگوی تازه' });
  await dialog.getByRole('radio', { name: 'گروه تازه' }).click();
  await dialog.getByRole('button', { name: 'ساخت گروه' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('نام گروه را بنویس.');
  await dialog.getByLabel('نام گروه').fill('شیفت صبح');
  await dialog.getByLabel('همکاران').fill('علی');
  await dialog.getByRole('button', { name: 'افزودن علی رضایی' }).click();
  await dialog.getByLabel('همکاران').fill('شیوا');
  await dialog.getByRole('button', { name: 'افزودن شیوا کاظمی' }).click();
  await dialog.getByRole('button', { name: 'ساخت گروه' }).click();

  const view = page.getByRole('region', { name: 'شیفت صبح' });
  await expect(view.getByText('۳ عضو')).toBeVisible();
  await view.getByRole('textbox', { name: 'پیام بنویس…' }).fill('فردا ساعت هشت جلسه داریم');
  await view.getByRole('textbox', { name: 'پیام بنویس…' }).press('Enter');
  await expect(view.getByText('فردا ساعت هشت جلسه داریم')).toBeVisible();

  // Rename from the info dialog.
  await view.getByRole('button', { name: 'اطلاعات گفت‌وگو' }).click();
  const info = page.getByRole('dialog', { name: 'اطلاعات گفت‌وگو' });
  await info.getByLabel('نام گروه').fill('شیفت صبح پشتیبانی');
  await info.getByRole('button', { name: 'تغییر نام گروه' }).click();
  await expect(page.getByText('نام گروه عوض شد').first()).toBeVisible();
  await info.getByRole('button', { name: 'بستن' }).click();
  await expect(info).toBeHidden();
  await expect(page.getByRole('region', { name: 'شیفت صبح پشتیبانی' })).toBeVisible();

  // The colleagues see it under its new name.
  const list = await ok<Array<{ title: string; kind: string }>>(
    await outsider.client.get('/api/conversations'),
  );
  expect(list.some((c) => c.kind === 'group' && c.title === 'شیفت صبح پشتیبانی')).toBe(true);

  // Maryam leaves; ownership passes on and the group disappears from her list.
  const renamed = page.getByRole('region', { name: 'شیفت صبح پشتیبانی' });
  await renamed.getByRole('button', { name: 'اطلاعات گفت‌وگو' }).click();
  await page
    .getByRole('dialog', { name: 'اطلاعات گفت‌وگو' })
    .getByRole('button', { name: 'ترک گروه' })
    .click();
  await page
    .getByRole('dialog', { name: 'از این گروه خارج می‌شوی؟' })
    .getByRole('button', { name: 'ترک گروه' })
    .click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText('از گروه خارج شدی').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /شیفت صبح پشتیبانی/ })).toHaveCount(0);

  const group = (
    await ok<Array<{ id: string; title: string }>>(await employee.client.get('/api/conversations'))
  ).find((c) => c.title === 'شیفت صبح پشتیبانی');
  const detail = await ok<{ members: Array<{ displayName: string; owner: boolean }> }>(
    await employee.client.get(`/api/conversations/${group?.id}`),
  );
  expect(detail.members.map((m) => m.displayName).sort()).toEqual(['شیوا کاظمی', 'علی رضایی']);
  expect(detail.members.some((m) => m.owner)).toBe(true);
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNgYGD4z4AFMOAUAQA7ZQEFyBkiXQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

test('files, a mention in a muted channel, and a reaction that goes live', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  const project = await ok<{ id: string }>(
    await manager.client.post('/api/projects', {
      data: { name: 'اپ موبایل', memberIds: [employee.person.memberId] },
    }),
  );
  const channel = await ok<{ id: string }>(
    await manager.client.get(`/api/conversations/by-project/${project.id}`),
  );
  // Maryam mutes the channel: plain messages stay quiet, a mention still reaches her.
  await ok(
    await manager.client.put(`/api/conversations/${channel.id}/mute`, { data: { muted: true } }),
  );
  const managerPage = await (await browser.newContext({ baseURL })).newPage();
  await signIn(managerPage, manager.person.username, 'مریم');
  await expect(bell(managerPage)).toHaveAccessibleName('اعلان‌ها');

  await signIn(page, employee.person.username, 'علی');
  await page.goto(`/chat/${channel.id}`);
  const view = page.getByRole('region', { name: 'اپ موبایل' });
  const composer = view.getByRole('form', { name: 'نوشتن پیام' });
  await composer.locator('input[type=file]').setInputFiles([
    { name: 'خطای صفحه.png', mimeType: 'image/png', buffer: PNG },
    { name: 'گزارش آزمون.pdf', mimeType: 'application/pdf', buffer: PDF },
  ]);
  const attached = composer.getByRole('list', { name: 'فایل‌های این پیام' });
  await expect(attached.getByText('گزارش آزمون.pdf')).toBeVisible();
  await expect(attached.getByText('خطای صفحه.png')).toBeVisible();

  // «@» opens the people of this conversation; picking one writes the name.
  const box = composer.getByLabel('پیام بنویس…');
  await box.pressSequentially('@مری');
  await composer.getByRole('option', { name: 'مریم احمدی' }).click();
  await box.pressSequentially('این خطا را ببین');
  await box.press('Enter');

  await expect(view.getByText('@مریم احمدی')).toBeVisible();
  await expect(view.getByRole('button', { name: 'دیدن تصویر خطای صفحه.png' })).toBeVisible();
  await expect(view.getByText('گزارش آزمون.pdf')).toBeVisible();
  await expect(attached).toHaveCount(0);

  // Maryam: a mention notification despite the mute, and «@» on the conversation.
  await expect(bell(managerPage)).toHaveAccessibleName('اعلان‌ها، ۱ خوانده‌نشده', {
    timeout: 15_000,
  });
  await managerPage.goto('/chat');
  const row = managerPage.getByRole('link', { name: /اپ موبایل/ });
  await expect(row.getByRole('img', { name: 'از تو نام برده‌اند' })).toBeVisible();
  await row.click();
  const managerView = managerPage.getByRole('region', { name: 'اپ موبایل' });
  await managerView.getByRole('button', { name: 'دیدن تصویر خطای صفحه.png' }).click();
  await expect(managerPage.getByRole('dialog', { name: 'خطای صفحه.png' })).toBeVisible();
  await managerPage.keyboard.press('Escape');

  // She reacts from the message menu; Ali sees it live; tapping the chip takes it back.
  await managerView.getByRole('button', { name: 'کارهای پیام' }).last().click();
  await managerPage.getByRole('menuitem', { name: 'واکنش' }).click();
  await managerPage
    .getByRole('dialog', { name: 'واکنش' })
    .getByRole('button', { name: 'واکنش 👍' })
    .click();
  const chip = view.getByRole('button', { name: '👍 ۱: مریم احمدی' });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await managerView.getByRole('button', { name: '👍 ۱: مریم احمدی' }).click();
  await expect(chip).toHaveCount(0, { timeout: 15_000 });
  await managerPage.context().close();
});

test('a task from a message, search that jumps to it, and the owner exports the channel', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { manager, employee, ownerLogin } = await setUpCompany(baseURL ?? '');
  const project = await ok<{ id: string }>(
    await manager.client.post('/api/projects', {
      data: { name: 'درگاه پرداخت', memberIds: [employee.person.memberId] },
    }),
  );
  const channel = await ok<{ id: string }>(
    await manager.client.get(`/api/conversations/by-project/${project.id}`),
  );
  await ok(
    await manager.client.post(`/api/conversations/${channel.id}/messages`, {
      data: { body: 'صفحه خطای پرداخت را کسی درست کند\nلاگ‌ها روی سرور تست ۴۰۲۱ است' },
    }),
  );
  for (let i = 0; i < 3; i++) {
    await ok(
      await manager.client.post(`/api/conversations/${channel.id}/messages`, {
        data: { body: `پیام بعدی ${i}` },
      }),
    );
  }

  // Ali makes a task from the message; the title comes from its first line.
  await signIn(page, employee.person.username, 'علی');
  await page.goto(`/chat/${channel.id}`);
  const view = page.getByRole('region', { name: 'درگاه پرداخت' });
  const bubble = view.locator('[id^="message-"]').filter({ hasText: 'صفحه خطای پرداخت' });
  await bubble.getByRole('button', { name: 'کارهای پیام' }).click();
  await page.getByRole('menuitem', { name: 'ساختن کار' }).click();
  const dialog = page.getByRole('dialog', { name: 'ساختن کار' });
  await expect(dialog.getByLabel('عنوان')).toHaveValue('صفحه خطای پرداخت را کسی درست کند');
  await dialog.getByRole('button', { name: 'ساختن کار' }).click();
  await expect(
    page.getByText('کار «صفحه خطای پرداخت را کسی درست کند» ساخته شد').first(),
  ).toBeVisible();
  await bubble.getByRole('button', { name: 'کار شد' }).click();
  await page
    .getByRole('dialog', { name: 'کارهای این پیام' })
    .getByRole('link', { name: 'صفحه خطای پرداخت را کسی درست کند' })
    .click();
  const evidence = page.getByRole('region', { name: 'شاهدهای کار' });
  await evidence.getByRole('button', { name: 'دیدن پیام سنجاق‌شده از درگاه پرداخت' }).click();
  const viewer = page.getByRole('dialog', { name: 'پیام مریم احمدی در درگاه پرداخت' });
  await expect(viewer.getByText(/لاگ‌ها روی سرور تست/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Search finds it with Latin digits and opens the conversation at that message.
  await page.goto('/chat');
  await page.getByLabel('جست‌وجو در گفت‌وگوها').fill('4021');
  const results = page.getByRole('region', { name: 'پیام‌ها' });
  await results.getByRole('link', { name: /سرور تست/ }).click();
  await expect(page).toHaveURL(/\?m=/);
  await expect(page.getByLabel('پیام پیدا شده')).toContainText('سرور تست');
  await page.getByRole('button', { name: 'رفتن به آخرین پیام‌ها' }).click();
  await expect(page).not.toHaveURL(/\?m=/);

  // The owner exports the channel; the file has the message, and the export is in the log.
  const ownerPage = await (await browser.newContext({ baseURL })).newPage();
  await signInOwner(ownerPage, ownerLogin);
  await ownerPage.goto('/org/chat-export');
  await expect(
    ownerPage.getByText('گفت‌وگوهای خصوصی و گروه هیچ‌وقت خروجی ندارند', { exact: false }),
  ).toBeVisible();
  const download = ownerPage.waitForEvent('download');
  await ownerPage.getByRole('button', { name: 'دریافت فایل درگاه پرداخت' }).click();
  const file = await download;
  // The Persian file name is not checked: headless Chromium in a non-UTF-8 container reports
  // non-ASCII download names as «download»; real browsers keep them.
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain('صفحه خطای پرداخت');
  expect(csv).toContain('مریم احمدی');
  await ownerPage.goto('/audit');
  await expect(ownerPage.getByText('خروجی گرفتن از کانال گفت‌وگو').first()).toBeVisible();
  await ownerPage.context().close();
});
