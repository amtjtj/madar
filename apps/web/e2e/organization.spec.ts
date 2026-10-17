import { expect, test, type Page } from '@playwright/test';

import { totp } from './totp';

const PASSWORD = 'Strong-Password-1';

async function signupCompany(page: Page, id: string) {
  await page.goto('/signup');
  await page.getByLabel('نام شرکت').fill('زرین‌مدار');
  await page.getByLabel('شناسه شرکت (انگلیسی)').fill(`zarrin-${id}`);
  await page.getByLabel('نام و نام خانوادگی').fill('مریم احمدی');
  await page.getByLabel('نام کاربری (انگلیسی)').fill(`maryam.${id}`);
  await page.getByLabel(/^رمز عبور/).fill(PASSWORD);
  await page.getByLabel('تکرار رمز عبور').fill(PASSWORD);
  await page.getByRole('button', { name: 'ثبت شرکت' }).click();
}

async function setUpTwoFactor(page: Page) {
  await expect(page).toHaveURL(/\/setup-2fa/);
  await page.getByLabel(/^رمز عبور/).fill(PASSWORD);
  await page.getByRole('button', { name: 'ادامه' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  await page.getByLabel('کد شش‌رقمی').fill(totp(secret));
  await page.getByRole('button', { name: 'فعال‌سازی' }).click();
}

test('signed-out visitors are sent to login and come back afterwards', async ({ page }) => {
  await page.goto('/members');
  await expect(page).toHaveURL(/\/login\?next=%2Fmembers/);
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
});

test('wrong credentials show a Persian error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('نام کاربری').fill('nobody.here');
  await page.getByLabel(/^رمز عبور/).fill('wrong-password-123');
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'نام کاربری یا رمز عبور اشتباه است' }),
  ).toBeVisible();
});

test('owner registers, sets up 2FA, builds the org and adds a member who signs in', async ({
  page,
  browser,
}) => {
  test.slow();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  await signupCompany(page, id);
  await setUpTwoFactor(page);
  await expect(page.getByRole('heading', { name: 'سلام مریم' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'راه‌اندازی شرکت' })).toBeVisible();

  // Departments: a parent, a child, and oversight on the parent
  await page.goto('/departments');
  await page.getByRole('button', { name: 'دپارتمان جدید' }).first().click();
  await page.getByLabel('نام دپارتمان').fill('مدیریت ارشد');
  await page.getByRole('button', { name: 'ذخیره' }).click();
  const list = page.getByTestId('department-list');
  await expect(list.getByText('مدیریت ارشد')).toBeVisible();
  await page.getByRole('button', { name: 'دپارتمان جدید' }).first().click();
  await page.getByLabel('نام دپارتمان').fill('پشتیبانی');
  await page.getByLabel('زیرمجموعه‌ی').selectOption({ label: 'مدیریت ارشد' });
  await page.getByRole('button', { name: 'ذخیره' }).click();
  await expect(list.getByText('پشتیبانی')).toBeVisible();

  await page.getByRole('button', { name: 'عملیات: مدیریت ارشد' }).click();
  await page.getByRole('menuitem', { name: 'دسترسی ناظر' }).click();
  await page.getByLabel('کارها').check();
  await page.getByRole('button', { name: 'ذخیره' }).click();
  await expect(list.getByText('ناظر', { exact: true })).toBeVisible();

  // Members: add an employee and read the one-time temporary password
  await page.goto('/members');
  await page.getByRole('button', { name: 'عضو جدید' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('نام و نام خانوادگی').fill('سارا محمدی');
  await dialog.getByLabel('نام کاربری (انگلیسی)').fill(`sara.${id}`);
  await dialog.getByLabel('سمت').fill('کارشناس پشتیبانی');
  await dialog.getByLabel('دپارتمان اصلی').selectOption({ label: '— پشتیبانی' });
  await dialog.getByLabel('مدیر مستقیم').selectOption({ label: 'مریم احمدی' });
  await dialog.getByRole('button', { name: 'ذخیره' }).click();
  const temporaryPassword =
    (await page.getByTestId('temporary-password').textContent())?.trim() ?? '';
  expect(temporaryPassword).toMatch(/^\w{4}-\w{4}-\w{4}$/);
  await page.getByRole('button', { name: 'متوجه شدم' }).click();
  await expect(page.getByTestId('member-list').getByText('سارا محمدی')).toBeVisible();

  // Org chart and audit log reflect the changes
  await page.goto('/org-chart');
  await expect(page.getByText('سارا محمدی')).toBeVisible();
  await page.goto('/audit');
  await expect(page.getByTestId('audit-list')).toContainText('تغییر دسترسی ناظر');
  await expect(page.getByTestId('audit-list')).toContainText('افزودن عضو');

  // The employee signs in, must change the temporary password, and sees no admin tools
  const employee = await (await browser.newContext()).newPage();
  await employee.goto('/login');
  await employee.getByLabel('نام کاربری').fill(`sara.${id}`);
  await employee.getByLabel(/^رمز عبور/).fill(temporaryPassword);
  await employee.getByRole('button', { name: 'ورود' }).click();
  await expect(employee).toHaveURL(/\/change-password/);
  await employee.getByLabel(/^رمز فعلی/).fill(temporaryPassword);
  await employee.getByLabel(/^رمز جدید/).fill('Sara-New-Password-1');
  await employee.getByLabel(/^تکرار رمز جدید/).fill('Sara-New-Password-1');
  await employee.getByRole('button', { name: 'ذخیره رمز جدید' }).click();
  await expect(employee.getByRole('heading', { name: 'سلام سارا' })).toBeVisible();
  await employee.goto('/members');
  await expect(employee.getByTestId('member-list')).toBeVisible();
  await expect(employee.getByRole('button', { name: 'عضو جدید' })).toHaveCount(0);
  await expect(employee.getByRole('link', { name: 'گزارش تغییرات' })).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
