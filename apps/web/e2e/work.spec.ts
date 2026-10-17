import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

import { totp } from './totp';

const PASSWORD = 'Strong-Password-1';

interface Person {
  username: string;
  memberId: string;
}

/** API client with the trusted Origin (Better Auth checks it). */
function apiClient(baseURL: string) {
  return request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

/**
 * A company with a support department (manager + employee) and a marketing employee,
 * set up through the API so the test can focus on the work screens.
 */
async function setUpCompany(baseURL: string) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const owner = await apiClient(baseURL);
  await ok(
    await owner.post('/api/tenants', {
      data: {
        companyName: 'زرین‌مدار',
        slug: `work-${id}`,
        adminName: 'رضا کریمی',
        username: `owner.${id}`,
        password: PASSWORD,
      },
    }),
  );
  await ok(
    await owner.post('/api/auth/sign-in/username', {
      data: { username: `owner.${id}`, password: PASSWORD },
    }),
  );
  const { totpURI } = await ok<{ totpURI: string }>(
    await owner.post('/api/auth/two-factor/enable', { data: { password: PASSWORD } }),
  );
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  await ok(await owner.post('/api/auth/two-factor/verify-totp', { data: { code: totp(secret) } }));

  const support = await ok<{ id: string }>(
    await owner.post('/api/departments', { data: { name: 'پشتیبانی' } }),
  );
  const marketing = await ok<{ id: string }>(
    await owner.post('/api/departments', { data: { name: 'مارکتینگ' } }),
  );

  const createMember = async (name: string, departmentId: string, deptRole: string) => {
    const username = `m.${id}.${Math.random().toString(36).slice(2, 7)}`;
    const created = await ok<{ temporaryPassword: string; member: { id: string } }>(
      await owner.post('/api/members', {
        data: {
          displayName: name,
          username,
          roles: ['member'],
          departments: [{ departmentId, deptRole, isPrimary: true }],
        },
      }),
    );
    const client = await apiClient(baseURL);
    await ok(
      await client.post('/api/auth/sign-in/username', {
        data: { username, password: created.temporaryPassword },
      }),
    );
    await ok(
      await client.post('/api/me/password', {
        data: { currentPassword: created.temporaryPassword, newPassword: PASSWORD },
      }),
    );
    return { person: { username, memberId: created.member.id } as Person, client };
  };

  const manager = await createMember('مریم احمدی', support.id, 'manager');
  const employee = await createMember('علی رضایی', support.id, 'member');
  const outsider = await createMember('شیوا کاظمی', marketing.id, 'member');
  return { manager, employee, outsider };
}

async function signIn(page: Page, username: string, firstName: string) {
  await page.goto('/login');
  await page.getByLabel('نام کاربری').fill(username);
  await page.getByLabel(/^رمز عبور/).fill(PASSWORD);
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.getByRole('heading', { name: `سلام ${firstName}` })).toBeVisible();
}

test('today, assignment, comments, board and department visibility', async ({
  page,
  baseURL,
}, testInfo) => {
  test.slow();
  const { manager, employee, outsider } = await setUpCompany(baseURL ?? '');
  await signIn(page, employee.person.username, 'علی');

  // Today: quick add, then complete it; the day's progress follows.
  await expect(page.getByText('هنوز کاری برای امروز نچیده‌ای')).toBeVisible();
  await page.getByLabel('کار تازه برای امروز').fill('ارسال گزارش روزانه');
  await page.keyboard.press('Enter');
  const todayTask = page.getByRole('checkbox', { name: /ارسال گزارش روزانه/ });
  await expect(todayTask).toBeVisible();
  await expect(page.getByText('۰ از ۱ کار امروز')).toBeVisible();
  await todayTask.click();
  await expect(page.getByText('۱ از ۱ کار امروز')).toBeVisible();
  await expect(page.getByText('همه کارهای امروز انجام شد!')).toBeVisible();

  // The manager assigns a task; it shows under «my tasks» and as a suggestion for today.
  const assigned = await ok<{ id: string }>(
    await manager.client.post('/api/tasks', {
      data: { title: 'پیگیری تیکت شماره ۴۲', assigneeId: employee.person.memberId },
    }),
  );
  await page.goto('/tasks');
  const card = page.getByRole('button', { name: 'پیگیری تیکت شماره ۴۲' });
  await expect(card).toBeVisible();

  // Comment on it.
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${assigned.id}`));
  await page.getByPlaceholder('نظرت را بنویس…').fill('شروع کردم؛ تا عصر تمام می‌شود.');
  await page.getByRole('button', { name: 'ارسال' }).click();
  await expect(page.getByText('شروع کردم؛ تا عصر تمام می‌شود.')).toBeVisible();

  // Board: move the card to «in progress» with the keyboard (same path as drag and drop).
  await page.goto('/tasks');
  await page.getByRole('radio', { name: 'برد' }).click();
  const todo = page.getByRole('region', { name: 'انجام‌نشده' });
  const doing = page.getByRole('region', { name: 'در حال انجام' });
  await expect(todo.getByText('پیگیری تیکت شماره ۴۲')).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    const draggable = todo
      .locator('[aria-roledescription]')
      .filter({ hasText: 'پیگیری تیکت شماره ۴۲' });
    await draggable.focus();
    // Wait for each screen-reader announcement, as a keyboard user would.
    const live = page.locator('[aria-live]');
    await page.keyboard.press('Space');
    await expect(draggable).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(live.filter({ hasText: 'انتقال به در حال انجام' })).toHaveCount(1);
    await page.keyboard.press('Space');
    await expect(doing.getByText('پیگیری تیکت شماره ۴۲')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await ok<{ statusKey: string }>(await employee.client.get(`/api/tasks/${assigned.id}`)))
            .statusKey,
      )
      .toBe('in_progress');
  }

  // Someone in another department cannot see it.
  expect((await outsider.client.get(`/api/tasks/${assigned.id}`)).status()).toBe(404);
  const outsiderList = await ok<Array<{ id: string }>>(
    await outsider.client.get('/api/tasks?view=visible&status=all'),
  );
  expect(outsiderList.map((t) => t.id)).not.toContain(assigned.id);
});
