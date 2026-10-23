import { expect, test, type Locator, type Page } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

/** Titles of the cards in a list, top to bottom. */
const titles = (list: Locator) =>
  list
    .getByRole('checkbox')
    .evaluateAll((boxes) =>
      boxes.map((box) => (box.getAttribute('aria-label') ?? '').split(' — ')[0]),
    );

/** Keyboard drag: Space on the handle, arrows, Space to drop (waits for each announcement). */
async function moveDown(page: Page, list: Locator, title: string, steps: number) {
  const handle = list.getByRole('button', { name: `جابه‌جا کردن «${title}»` });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  const live = page.locator('[aria-live]');
  const total = await list.getByRole('listitem').count();
  const start = (await titles(list)).indexOf(title);
  for (let i = 1; i <= steps; i++) {
    await page.keyboard.press('ArrowDown');
    const position = (start + i + 1).toLocaleString('fa-IR');
    await expect(
      live.filter({ hasText: `به جایگاه ${position} از ${total.toLocaleString('fa-IR')} رفت` }),
    ).toHaveCount(1);
  }
  await page.keyboard.press('Space');
  await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
}

test("the CEO's task leads «today» with its reason; the member reorders and it sticks", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { owner, manager, employee, support } = await setUpCompany(baseURL ?? '');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
  const create = async (client: typeof owner, data: object) =>
    ok<{ id: string }>(await client.post('/api/tasks', { data }));

  // Created in the reverse of the expected order, so time of creation cannot explain it.
  const mine = await create(employee.client, { title: 'مرتب کردن پوشه‌ها', priority: 'low' });
  const fromManager = await create(manager.client, {
    title: 'پاسخ به تیکت‌های صف',
    assigneeId: employee.person.memberId,
  });
  const fromCeo = await create(owner, {
    title: 'گزارش برای هیئت‌مدیره',
    assigneeId: employee.person.memberId,
    departmentId: support.id,
    dueOn: today,
  });
  for (const task of [mine, fromManager, fromCeo]) {
    await ok(await employee.client.post(`/api/today/items/${task.id}`));
  }

  await signIn(page, employee.person.username, 'علی');
  const plan = page.getByRole('list', { name: 'کارهای امروز' });
  await expect
    .poll(() => titles(plan))
    .toEqual(['گزارش برای هیئت‌مدیره', 'پاسخ به تیکت‌های صف', 'مرتب کردن پوشه‌ها']);
  const top = plan.getByRole('listitem').first();
  await expect(top.getByText('ابلاغ مدیرعامل').first()).toBeVisible();
  await expect(
    top.getByRole('button', { name: 'چرا این‌جا؟ سررسید امروز و ابلاغ مدیرعامل' }),
  ).toBeVisible();
  await expect(plan.getByText('ابلاغ مریم احمدی')).toBeVisible();
  await expect(page.getByRole('button', { name: 'مرتب‌سازی خودکار' })).toHaveCount(0);

  // Keyboard: move the CEO's task to the bottom; the order survives a reload.
  await moveDown(page, plan, 'گزارش برای هیئت‌مدیره', 2);
  const byHand = ['پاسخ به تیکت‌های صف', 'مرتب کردن پوشه‌ها', 'گزارش برای هیئت‌مدیره'];
  await expect.poll(() => titles(plan)).toEqual(byHand);
  await page.reload();
  await expect.poll(() => titles(plan)).toEqual(byHand);

  // Back to the automatic order.
  await page.getByRole('button', { name: 'مرتب‌سازی خودکار' }).click();
  await expect
    .poll(() => titles(plan))
    .toEqual(['گزارش برای هیئت‌مدیره', 'پاسخ به تیکت‌های صف', 'مرتب کردن پوشه‌ها']);
  await expect(page.getByRole('button', { name: 'مرتب‌سازی خودکار' })).toHaveCount(0);
});

test('«my tasks»: drag with the mouse, filter by source', async ({ page, baseURL }) => {
  test.slow();
  const { owner, employee, createMember, support } = await setUpCompany(baseURL ?? '');
  const colleague = await createMember('زهرا محمدی', support.id, 'member');
  const create = async (client: typeof owner, data: object) =>
    ok<{ id: string }>(await client.post('/api/tasks', { data }));
  await create(employee.client, { title: 'یادداشت‌های شخصی' });
  // A colleague's request comes through a shared project (plan phase-3-step-17a).
  const shared = await ok<{ id: string }>(
    await owner.post('/api/projects', {
      data: { name: 'تیکت‌های مشترک', departmentId: support.id },
    }),
  );
  await create(colleague.client, {
    title: 'کمک در تیکت مشترک',
    assigneeId: employee.person.memberId,
    projectId: shared.id,
  });
  await create(owner, {
    title: 'برنامه سه‌ماهه',
    assigneeId: employee.person.memberId,
    departmentId: support.id,
    priority: 'high',
  });

  await signIn(page, employee.person.username, 'علی');
  await page.goto('/tasks');
  const list = page.getByRole('list', { name: 'کارهای باز، به ترتیب اولویت' });
  await expect
    .poll(() => titles(list))
    .toEqual(['برنامه سه‌ماهه', 'کمک در تیکت مشترک', 'یادداشت‌های شخصی']);
  await expect(list.getByText('درخواست زهرا محمدی')).toBeVisible();

  // Mouse: drag the personal note above everything.
  const from = list.getByRole('button', { name: 'جابه‌جا کردن «یادداشت‌های شخصی»' });
  const to = list.getByRole('button', { name: 'جابه‌جا کردن «برنامه سه‌ماهه»' });
  // On a phone the last card sits near the bottom edge (cards show their project), where the
  // drag would scroll the page: centre the list first.
  await from.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error('handles not laid out');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y - 10, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 2, { steps: 15 });
  await page.mouse.up();
  const byHand = ['یادداشت‌های شخصی', 'برنامه سه‌ماهه', 'کمک در تیکت مشترک'];
  await expect.poll(() => titles(list)).toEqual(byHand);
  await page.reload();
  await expect.poll(() => titles(list)).toEqual(byHand);

  // Source filter.
  const sources = page.getByRole('radiogroup', { name: 'منبع کار' });
  await sources.getByRole('radio', { name: 'درخواست همکار' }).click();
  await expect.poll(() => titles(list)).toEqual(['کمک در تیکت مشترک']);
  await sources.getByRole('radio', { name: 'همه' }).click();
  await expect.poll(() => titles(list)).toEqual(byHand);

  // Back to the automatic order.
  await page.getByRole('button', { name: 'مرتب‌سازی خودکار' }).click();
  await expect
    .poll(() => titles(list))
    .toEqual(['برنامه سه‌ماهه', 'کمک در تیکت مشترک', 'یادداشت‌های شخصی']);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('hold the handle briefly, then drag', async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phones only');
    test.slow();
    const { employee } = await setUpCompany(baseURL ?? '');
    for (const title of ['اول', 'دوم', 'سوم']) {
      await ok(await employee.client.post('/api/tasks', { data: { title } }));
    }
    await signIn(page, employee.person.username, 'علی');
    await page.goto('/tasks');
    const list = page.getByRole('list', { name: 'کارهای باز، به ترتیب اولویت' });
    // Same score: the newest first.
    await expect.poll(() => titles(list)).toEqual(['سوم', 'دوم', 'اول']);

    const box = async (title: string) => {
      const b = await list.getByRole('button', { name: `جابه‌جا کردن «${title}»` }).boundingBox();
      if (!b) throw new Error('handle not laid out');
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    };
    const from = await box('اول');
    const to = await box('سوم');
    const cdp = await page.context().newCDPSession(page);
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      point?: { x: number; y: number },
    ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
    await touch('touchStart', from);
    // Hold past the sensor's delay, so a quick swipe still scrolls the page.
    await page.waitForTimeout(300);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', { x: from.x, y: from.y + ((to.y - 4 - from.y) * i) / 10 });
    }
    await touch('touchEnd');
    const byHand = ['اول', 'سوم', 'دوم'];
    await expect.poll(() => titles(list)).toEqual(byHand);
    await page.reload();
    await expect.poll(() => titles(list)).toEqual(byHand);
  });
});
