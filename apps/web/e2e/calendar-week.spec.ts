import { expect, test, type Locator, type Page } from '@playwright/test';

import { ok, setUpCompany, signIn } from './company';

/** A calendar day in the company's time zone (the default, Tehran). */
const dayIn = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Saturday of next week (Saturday = 0 in the Persian week). */
const nextSaturday = () => {
  const today = dayIn(0);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 1) % 7;
  return addDays(today, 7 - weekday);
};
/** Tehran wall-clock time on a day, as an instant (no daylight saving since 1401). */
const tehran = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+03:30`).toISOString();

/** dnd-kit listens to pointer moves: press, travel in steps, release. */
async function dragTo(page: Page, handle: Locator, target: Locator) {
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('nothing to drag');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("desktop: drag a due date across the week, and open a team member's calendar", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the week view is for wide screens');
  test.slow();
  const { manager, employee, support, createMember } = await setUpCompany(baseURL ?? '');
  const zahra = await createMember('زهرا موسوی', support.id, 'member');
  const saturday = nextSaturday();
  const monday = addDays(saturday, 2);
  await ok(
    await manager.client.post('/api/tasks', {
      data: { title: 'گزارش هفتگی صف', dueOn: saturday },
    }),
  );
  await ok(
    await employee.client.post('/api/tasks', {
      data: { title: 'پاسخ تیکت‌های معوق', dueOn: addDays(saturday, 1) },
    }),
  );
  await ok(
    await employee.client.post('/api/meetings', {
      data: {
        type: 'one_on_one',
        title: 'گفت‌وگوی ماهانه علی و زهرا',
        startsAt: tehran(addDays(saturday, 1), '10:00'),
        endsAt: tehran(addDays(saturday, 1), '10:30'),
        participantIds: [zahra.person.memberId],
      },
    }),
  );
  await signIn(page, manager.person.username, 'مریم');

  await page.goto(`/calendar?view=week&date=${saturday}`);
  const handle = page.getByRole('button', { name: 'جابه‌جا کردن «گزارش هفتگی صف» به روز دیگر' });
  await expect(handle).toBeVisible();
  await dragTo(page, handle, page.locator(`[data-day="${monday}"]`).first());
  await expect(page.getByText(/سررسید «گزارش هفتگی صف» به .* رفت/).first()).toBeVisible();
  await page.reload();
  await expect(
    page.locator(`[data-day="${monday}"]`).getByRole('link', { name: 'گزارش هفتگی صف' }),
  ).toBeVisible();
  await expect(
    page.locator(`[data-day="${saturday}"]`).getByRole('link', { name: 'گزارش هفتگی صف' }),
  ).toHaveCount(0);

  // Ali's calendar: his task, not his one-on-one with Zahra.
  await page.getByLabel('تقویم چه کسی؟').selectOption({ label: 'علی رضایی (پشتیبانی)' });
  await expect(page.getByRole('heading', { name: 'تقویم علی رضایی' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'پاسخ تیکت‌های معوق' })).toBeVisible();
  await expect(page.getByRole('link', { name: /گفت‌وگوی ماهانه علی و زهرا/ })).toHaveCount(0);
  // Maryam manages support: she may move it too.
  await expect(
    page.getByRole('button', { name: 'جابه‌جا کردن «پاسخ تیکت‌های معوق» به روز دیگر' }),
  ).toBeVisible();
});

test('phone: the day view, a meeting on its hour, and «تغییر سررسید»', async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the phone layout');
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  const tomorrow = dayIn(1);
  await ok(
    await manager.client.post('/api/meetings', {
      data: {
        type: 'regular',
        title: 'هماهنگی صف برداشت',
        startsAt: tehran(tomorrow, '10:00'),
        endsAt: tehran(tomorrow, '11:00'),
        participantIds: [employee.person.memberId],
      },
    }),
  );
  await ok(
    await employee.client.post('/api/tasks', {
      data: { title: 'پیگیری تیکت‌های امروز', dueOn: dayIn(0) },
    }),
  );
  await signIn(page, employee.person.username, 'علی');

  await page.goto(`/calendar?view=day&date=${tomorrow}`);
  await expect(page.getByRole('link', { name: /هماهنگی صف برداشت/ })).toBeVisible();
  // Phones have no week view.
  await expect(page.getByRole('radio', { name: 'هفته' })).toHaveCount(0);

  await page.goto('/calendar?view=day');
  await page.getByRole('button', { name: 'تغییر سررسید «پیگیری تیکت‌های امروز»' }).click();
  const dialog = page.getByRole('dialog', { name: 'تغییر سررسید «پیگیری تیکت‌های امروز»' });
  await dialog.getByRole('button', { name: /سررسید تازه/ }).click();
  await page.getByRole('button', { name: 'فردا', exact: true }).click();
  await expect(page.getByText(/سررسید «پیگیری تیکت‌های امروز» به .* رفت/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'پیگیری تیکت‌های امروز' })).toHaveCount(0);
  await page.goto(`/calendar?view=day&date=${tomorrow}`);
  await expect(page.getByRole('link', { name: /پیگیری تیکت‌های امروز/ })).toBeVisible();
});
