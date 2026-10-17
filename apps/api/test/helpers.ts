import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { Auth } from '../src/auth/auth.js';
import { AUTH } from '../src/auth/auth.tokens.js';
import { ENV } from '../src/config/config.module.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { totpFromUri } from './totp.js';

export const hasDatabase = Boolean(process.env.APP_DATABASE_URL ?? loadEnvSafe()?.APP_DATABASE_URL);

function loadEnvSafe(): Env | null {
  try {
    return loadEnv();
  } catch {
    return null;
  }
}

/** The full API (real database, real Better Auth) for integration tests. */
export async function createTestApp(overrides: Partial<Env> = {}) {
  const env = { ...loadEnv(), ...overrides };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: process.env.TEST_LOG ? ['error'] : false,
  });
  configureApp(app, env, app.get<Auth>(AUTH));
  await app.init();
  return { app, env };
}

export function unique(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

/** A cookie-keeping client whose requests carry the trusted Origin (Better Auth checks it). */
export function client(app: NestExpressApplication, env: Env) {
  const agent = request.agent(app.getHttpServer());
  const origin = env.AUTH_BASE_URL;
  return {
    get: (url: string) => agent.get(url).set('Origin', origin),
    post: (url: string, body?: object) =>
      agent
        .post(url)
        .set('Origin', origin)
        .send(body ?? {}),
    patch: (url: string, body?: object) =>
      agent
        .patch(url)
        .set('Origin', origin)
        .send(body ?? {}),
    put: (url: string, body?: object) =>
      agent
        .put(url)
        .set('Origin', origin)
        .send(body ?? {}),
    delete: (url: string) => agent.delete(url).set('Origin', origin),
  };
}
export type Client = ReturnType<typeof client>;

export const PASSWORD = 'Correct-Horse-42';

/** Registers a company and returns its owner's credentials. */
export async function signupCompany(c: Client, overrides: Record<string, string> = {}) {
  const body = {
    companyName: 'شرکت آزمایشی',
    slug: unique('co-'),
    adminName: 'مدیر آزمایشی',
    username: unique('owner.'),
    password: PASSWORD,
    ...overrides,
  };
  const res = await c.post('/api/tenants', body);
  return { res, body };
}

export async function signIn(c: Client, username: string, password = PASSWORD) {
  return c.post('/api/auth/sign-in/username', { username, password });
}

/** Turns on TOTP for the signed-in user and returns the otpauth URI (to compute later codes). */
export async function enableTwoFactor(c: Client, password = PASSWORD): Promise<string> {
  const enable = await c.post('/api/auth/two-factor/enable', { password });
  if (enable.status !== 200) throw new Error(`enable 2FA failed: ${enable.status} ${enable.text}`);
  const uri = enable.body.totpURI as string;
  const verify = await c.post('/api/auth/two-factor/verify-totp', { code: totpFromUri(uri) });
  if (verify.status !== 200) throw new Error(`verify TOTP failed: ${verify.status} ${verify.text}`);
  return uri;
}

/** Signs up a company and returns an owner client that is fully set up (2FA on). */
export async function ownerSession(app: NestExpressApplication, env: Env) {
  const c = client(app, env);
  const { res, body } = await signupCompany(c);
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${res.text}`);
  await signIn(c, body.username);
  const totpUri = await enableTwoFactor(c);
  return { c, ...body, tenantId: res.body.tenantId as string, totpUri };
}

/**
 * Creates a member through the API as `admin`, then signs them in on a fresh client and
 * completes the required steps (password change; 2FA when their role needs it).
 */
export async function memberSession(
  app: NestExpressApplication,
  env: Env,
  admin: Client,
  input: { roles?: string[]; departments?: object[]; displayName?: string; managerId?: string },
) {
  const username = unique('m.');
  const created = await admin.post('/api/members', {
    displayName: input.displayName ?? 'کارمند آزمایشی',
    username,
    roles: input.roles ?? ['member'],
    departments: input.departments ?? [],
    ...(input.managerId ? { managerId: input.managerId } : {}),
  });
  if (created.status !== 201)
    throw new Error(`create member failed: ${created.status} ${created.text}`);
  const c = client(app, env);
  await signIn(c, username, created.body.temporaryPassword);
  const changed = await c.post('/api/me/password', {
    currentPassword: created.body.temporaryPassword,
    newPassword: PASSWORD,
  });
  if (changed.status !== 204) throw new Error(`password change failed: ${changed.status}`);
  let totpUri: string | null = null;
  if (input.roles?.some((r) => r === 'owner' || r === 'admin')) totpUri = await enableTwoFactor(c);
  return { c, username, memberId: created.body.member.id as string, totpUri };
}
