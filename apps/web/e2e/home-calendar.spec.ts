import { expect, test } from '@playwright/test';

import { addDays, calendarDateIn, formatCalendarDate } from '@madar/shared';

import { ok, setUpCompany, signIn } from './company';

test('the home page previews the week: a day shows its meeting, and the full calendar is one tap away', async ({
  page,
  baseURL,
}) => {
  test.slow();
  const { manager, employee } = await setUpCompany(baseURL ?? '');
  const today = calendarDateIn(new Date(), 'Asia/Tehran');
  const later = addDays(today, 2);
  await ok(
    await manager.client.post('/api/meetings', {
      data: {
        type: 'regular',
        title: 'مرور هفتگی صف',
        startsAt: new Date(`${later}T06:30:00Z`).toISOString(),
        endsAt: new Date(`${later}T07:00:00Z`).toISOString(),
        participantIds: [employee.person.memberId],
      },
    }),
  );

  await signIn(page, employee.person.username, 'علی');
  await page.goto('/?tab=today');
  const card = page.getByRole('heading', { name: 'تقویم این هفته' }).locator('xpath=../../..');
  await expect(
    card.getByRole('group', { name: 'روزهای این هفته' }).getByRole('button'),
  ).toHaveCount(7);
  // Today is chosen first; the meeting's day has it.
  const day = card.getByRole('button', { name: new RegExp(formatCalendarDate(later, 'full')) });
  await expect(day).toHaveAccessibleName(/۱ مورد/);
  await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('link', { name: /مرور هفتگی صف/ })).toBeVisible();
  await card.getByRole('link', { name: 'تقویم کامل' }).click();
  await expect(page).toHaveURL(/\/calendar/);
});
