import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Env } from '../src/config/env.js';
import {
  client,
  createTestApp,
  enableTwoFactor,
  hasDatabase,
  PASSWORD,
  signIn,
  signupCompany,
  unique,
} from './helpers.js';
import { totpFromUri } from './totp.js';

describe.skipIf(!hasDatabase)('company signup and sign-in', () => {
  let app: NestExpressApplication;
  let env: Env;

  beforeAll(async () => {
    ({ app, env } = await createTestApp());
  });
  afterAll(() => app?.close());

  it('registers a company and its owner', async () => {
    const c = client(app, env);
    const { res, body } = await signupCompany(c);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ slug: body.slug, username: body.username });
  });

  it('validates input with the shared schema', async () => {
    const res = await signupCompany(client(app, env), { slug: 'Not A Slug!', password: 'short' });
    expect(res.res.status).toBe(400);
    expect(res.res.body.error.code).toBe('validation_failed');
  });

  it('rejects a taken company identifier or username', async () => {
    const c = client(app, env);
    const first = await signupCompany(c);
    const sameSlug = await signupCompany(c, { slug: first.body.slug });
    expect(sameSlug.res.status).toBe(409);
    expect(sameSlug.res.body.error.code).toBe('slug_taken');
    const sameUser = await signupCompany(c, { username: first.body.username });
    expect(sameUser.res.body.error.code).toBe('username_taken');
  });

  it('requires the signup code when one is configured', async () => {
    const guarded = await createTestApp({ TENANT_SIGNUP_CODE: 'pilot-2026' });
    try {
      const c = client(guarded.app, guarded.env);
      const without = await signupCompany(c);
      expect(without.res.status).toBe(403);
      expect(without.res.body.error.code).toBe('signup_code_invalid');
      const withCode = await signupCompany(c, { signupCode: 'pilot-2026' });
      expect(withCode.res.status).toBe(201);
    } finally {
      await guarded.app.close();
    }
  });

  it('does not allow public sign-up through Better Auth', async () => {
    const res = await client(app, env).post('/api/auth/sign-up/email', {
      email: `${unique('x')}@example.com`,
      password: PASSWORD,
      name: 'x',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('signs in with username; the owner must set up 2FA before anything else', async () => {
    const c = client(app, env);
    const { body } = await signupCompany(c);
    expect((await c.get('/api/me')).status).toBe(401);

    const wrong = await signIn(c, body.username, 'wrong-password-123');
    expect(wrong.status).toBe(401);

    const ok = await signIn(c, body.username);
    expect(ok.status).toBe(200);
    const me = await c.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.member.roles).toEqual(['owner']);
    expect(me.body.tenant.slug).toBe(body.slug);
    expect(me.body.pending).toEqual({
      passwordChange: false,
      twoFactorSetup: true,
      tenantSelection: false,
    });

    await enableTwoFactor(c);
    const after = await c.get('/api/me');
    expect(after.body.user.twoFactorEnabled).toBe(true);
    expect(after.body.pending.twoFactorSetup).toBe(false);
  });

  it('asks for the TOTP code at the next sign-in', async () => {
    const c = client(app, env);
    const { body } = await signupCompany(c);
    await signIn(c, body.username);
    const uri = await enableTwoFactor(c);
    await c.post('/api/auth/sign-out');
    expect((await c.get('/api/me')).status).toBe(401);

    const first = await signIn(c, body.username);
    expect(first.body.twoFactorRedirect).toBe(true);
    expect((await c.get('/api/me')).status).toBe(401);

    const badCode = await c.post('/api/auth/two-factor/verify-totp', { code: '000000' });
    expect(badCode.status).toBeGreaterThanOrEqual(400);
    const verify = await c.post('/api/auth/two-factor/verify-totp', { code: totpFromUri(uri) });
    expect(verify.status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200);
  });

  it('changes the password, keeps the session and accepts the new password', async () => {
    const c = client(app, env);
    const { body } = await signupCompany(c);
    await signIn(c, body.username);
    const bad = await c.post('/api/me/password', {
      currentPassword: 'nope-nope-nope',
      newPassword: 'New-Password-99',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_password');
    const changed = await c.post('/api/me/password', {
      currentPassword: PASSWORD,
      newPassword: 'New-Password-99',
    });
    expect(changed.status).toBe(204);
    expect((await c.get('/api/me')).status).toBe(200);

    const fresh = client(app, env);
    expect((await signIn(fresh, body.username)).status).toBe(401);
    expect((await signIn(fresh, body.username, 'New-Password-99')).status).toBe(200);
  });
});
