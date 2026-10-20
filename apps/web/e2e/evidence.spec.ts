import { expect, test } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

test('pin a letter to a task as evidence; the manager sees that letter only; unpin', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const { manager, employee, outsider: legal } = await setUpCompany(baseURL ?? '');
  // The manager assigns two tasks to Ali; Ali writes to someone in another department.
  const task = await ok<{ id: string }>(
    await manager.client.post('/api/tasks', {
      data: { title: 'پیگیری قرارداد پیمانکار', assigneeId: employee.person.memberId },
    }),
  );
  const other = await ok<{ id: string }>(
    await manager.client.post('/api/tasks', {
      data: { title: 'گزارش هفتگی صف', assigneeId: employee.person.memberId },
    }),
  );
  const upload = await ok<{ id: string }>(
    await employee.client.post('/api/uploads', {
      multipart: { file: { name: 'قرارداد.pdf', mimeType: 'application/pdf', buffer: PDF } },
    }),
  );
  const draft = await ok<{ id: string }>(
    await employee.client.post('/api/letters', {
      data: {
        subject: 'بررسی بندهای قرارداد',
        body: { format: 'lite', text: 'لطفاً **بند مدت** را بررسی کنید.' },
        to: [legal.person.memberId],
        uploadIds: [upload.id],
      },
    }),
  );
  await ok(await employee.client.post(`/api/letters/${draft.id}/send`));

  await signIn(page, employee.person.username, 'علی');
  await page.goto(`/tasks/${task.id}`);
  const section = page.getByRole('region', { name: 'شاهدهای کار' });
  await expect(section.getByText(/هنوز شاهدی سنجاق نشده/)).toBeVisible();

  // Pick the letter, read who will see it, pin.
  await section.getByRole('button', { name: 'سنجاق نامه' }).click();
  const dialog = page.getByRole('dialog', { name: 'سنجاق نامه به‌عنوان شاهد' });
  await dialog.getByRole('button', { name: 'انتخاب بررسی بندهای قرارداد' }).click();
  const note = dialog.getByRole('note');
  await expect(note.getByText('چه کسانی این نامه را خواهند دید')).toBeVisible();
  await expect(note.getByText('مریم احمدی (ثبت‌کننده)')).toBeVisible();
  await expect(note.getByText('اعضای دپارتمان «پشتیبانی»')).toBeVisible();
  await dialog.getByRole('button', { name: 'سنجاق', exact: true }).click();
  await expect(page.getByText('نامه به‌عنوان شاهد سنجاق شد').first()).toBeVisible();
  await expect(section.getByText('بررسی بندهای قرارداد')).toBeVisible();
  await expect(section.getByText('هنوز نخوانده')).toBeVisible();
  await expect(page.getByText(/نامه .* را به‌عنوان شاهد سنجاق کرد/)).toBeVisible();

  await page.goto('/tasks');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'پیگیری قرارداد پیمانکار' }).getByText('۱ شاهد'),
  ).toBeVisible();

  // The manager is not on the letter: the pinned letter opens from the task, the letter does not.
  const managerPage = await (await browser.newContext({ baseURL })).newPage();
  await signIn(managerPage, manager.person.username, 'مریم');
  await managerPage.goto(`/tasks/${task.id}`);
  await managerPage
    .getByRole('region', { name: 'شاهدهای کار' })
    .getByRole('button', { name: 'دیدن نامه بررسی بندهای قرارداد' })
    .click();
  const viewer = managerPage.getByRole('dialog', { name: 'بررسی بندهای قرارداد' });
  await expect(viewer.getByText('این نامه به‌عنوان شاهد این کار نمایش داده می‌شود.')).toBeVisible();
  await expect(viewer.locator('strong', { hasText: 'بند مدت' })).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'قرارداد.pdf', exact: true })).toBeVisible();
  await managerPage.keyboard.press('Escape');
  await managerPage.goto(`/letters/${draft.id}`);
  await expect(managerPage.getByText('این نامه پیدا نشد یا دسترسی به آن نداری.')).toBeVisible();
  await managerPage.context().close();

  // From the letter: pin it to the other task too; the letter lists both tasks.
  await page.goto(`/letters/${draft.id}`);
  await page.getByRole('button', { name: 'سنجاق به کار' }).click();
  const toTask = page.getByRole('dialog', { name: 'سنجاق این نامه به یک کار' });
  await toTask.getByRole('button', { name: 'انتخاب گزارش هفتگی صف' }).click();
  await toTask.getByRole('button', { name: 'سنجاق', exact: true }).click();
  const pinnedTo = page.getByRole('region', { name: 'سنجاق‌شده به این کارها' });
  await expect(pinnedTo.getByRole('link', { name: 'گزارش هفتگی صف' })).toBeVisible();
  await expect(pinnedTo.getByRole('link', { name: 'پیگیری قرارداد پیمانکار' })).toBeVisible();

  // Unpin from the first task.
  await page.goto(`/tasks/${task.id}`);
  await section.getByRole('button', { name: 'برداشتن شاهد بررسی بندهای قرارداد' }).click();
  await page
    .getByRole('dialog', { name: 'این شاهد برداشته شود؟' })
    .getByRole('button', { name: 'برداشتن' })
    .click();
  await expect(section.getByText(/هنوز شاهدی سنجاق نشده/)).toBeVisible();
  expect(other.id).toBeTruthy();
});
