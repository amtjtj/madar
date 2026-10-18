import { expect, request, type APIRequestContext, type Page } from '@playwright/test';

import { totp } from './totp';

export const PASSWORD = 'Strong-Password-1';

export interface Person {
  username: string;
  memberId: string;
}

/** API client with the trusted Origin (Better Auth checks it). */
export function apiClient(baseURL: string) {
  return request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
}

export async function ok<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

/**
 * A company with a support department (manager + employee) and a marketing employee,
 * set up through the API so the test can focus on the work screens.
 */
export async function setUpCompany(baseURL: string) {
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

  const createMember = async (
    name: string,
    departmentId: string,
    deptRole: string,
    roles: string[] = ['member'],
  ) => {
    const username = `m.${id}.${Math.random().toString(36).slice(2, 7)}`;
    const created = await ok<{ temporaryPassword: string; member: { id: string } }>(
      await owner.post('/api/members', {
        data: {
          displayName: name,
          username,
          roles,
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
  return { owner, support, marketing, manager, employee, outsider, createMember };
}

export async function signIn(page: Page, username: string, firstName: string) {
  await page.goto('/login');
  await page.getByLabel('نام کاربری').fill(username);
  await page.getByLabel(/^رمز عبور/).fill(PASSWORD);
  await page.getByRole('button', { name: 'ورود' }).click();
  await expect(page.getByRole('heading', { name: `سلام ${firstName}` })).toBeVisible();
}
