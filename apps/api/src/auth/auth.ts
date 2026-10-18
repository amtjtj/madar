import { schema, uuidv7, type Database } from '@madar/db';
import { USERNAME_PATTERN } from '@madar/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor, username } from 'better-auth/plugins';

import type { Env } from '../config/env.js';

/**
 * Better Auth handles identity only (ADR 0003): credentials, sessions, two-factor.
 * Tenants, members and roles are ours. Public sign-up is off; accounts are created server-side.
 */
export function createAuth(db: Database, env: Env) {
  return betterAuth({
    appName: 'Madar',
    baseURL: env.AUTH_BASE_URL,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.AUTH_BASE_URL, ...env.AUTH_TRUSTED_ORIGINS],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        twoFactor: schema.twoFactors,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        mustChangePassword: { type: 'boolean', defaultValue: false, input: false },
        phone: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      additionalFields: {
        activeTenantId: { type: 'string', required: false, input: false },
      },
    },
    advanced: {
      cookiePrefix: 'madar',
      useSecureCookies: env.NODE_ENV === 'production',
      database: { generateId: () => uuidv7() },
    },
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      window: 60,
      max: 60,
      customRules: {
        // Per IP: a whole office signs in from one address around 9:00 (ADR 0016).
        '/sign-in/username': { window: 60, max: 20 },
        '/two-factor/*': { window: 60, max: 5 },
        '/change-password': { window: 60, max: 5 },
      },
    },
    telemetry: { enabled: false },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameValidator: (value) => USERNAME_PATTERN.test(value),
      }),
      twoFactor({ issuer: 'Madar' }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
