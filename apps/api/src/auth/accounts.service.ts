import { randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { schema, uuidv7, type DbHandle } from '@madar/db';
import { eq } from 'drizzle-orm';

import { DB_HANDLE } from '../database/tokens.js';
import type { Auth } from './auth.js';
import { AUTH } from './auth.tokens.js';

/** Placeholder address for accounts without email (Better Auth requires one). Never shown or mailed. */
export function placeholderEmail(): string {
  return `${uuidv7()}@users.madar.invalid`;
}

const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A readable temporary password (no 0/O, 1/l/I) the admin hands to the employee once. */
export function generateTemporaryPassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

/** Server-side identity operations (public sign-up is disabled). */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  async findByUsername(username: string) {
    const [user] = await this.handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, username.toLowerCase()));
    return user ?? null;
  }

  /** Creates a user with a password credential. */
  async createUser(input: {
    name: string;
    username: string;
    password: string;
    mustChangePassword: boolean;
    phone?: string | null;
  }): Promise<{ id: string }> {
    const ctx = await this.auth.$context;
    const user = await ctx.internalAdapter.createUser(
      {
        name: input.name,
        email: placeholderEmail(),
        username: input.username.toLowerCase(),
        displayUsername: input.username,
        mustChangePassword: input.mustChangePassword,
        phone: input.phone ?? null,
      },
      { method: 'admin' },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(input.password),
    });
    return { id: user.id };
  }

  /** Sets a new password, optionally forcing a change at next login, and signs the user out everywhere. */
  async setPassword(userId: string, password: string, mustChangePassword: boolean): Promise<void> {
    const ctx = await this.auth.$context;
    await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
    await ctx.internalAdapter.updateUser(userId, { mustChangePassword });
    await ctx.internalAdapter.deleteUserSessions(userId);
  }

  async clearMustChangePassword(userId: string): Promise<void> {
    const ctx = await this.auth.$context;
    await ctx.internalAdapter.updateUser(userId, { mustChangePassword: false });
  }

  /** Removes two-factor so the user must set it up again (used when a device is lost). */
  async resetTwoFactor(userId: string): Promise<void> {
    const ctx = await this.auth.$context;
    await this.handle.db.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, userId));
    await ctx.internalAdapter.updateUser(userId, { twoFactorEnabled: false });
    await ctx.internalAdapter.deleteUserSessions(userId);
  }

  /** Removes an identity (only used to roll back a failed signup). */
  async deleteUser(userId: string): Promise<void> {
    const ctx = await this.auth.$context;
    await ctx.internalAdapter.deleteUser(userId);
  }

  async revokeSessions(userId: string): Promise<void> {
    const ctx = await this.auth.$context;
    await ctx.internalAdapter.deleteUserSessions(userId);
  }

  async setActiveTenant(sessionToken: string, tenantId: string): Promise<void> {
    await this.handle.db
      .update(schema.sessions)
      .set({ activeTenantId: tenantId })
      .where(eq(schema.sessions.token, sessionToken));
  }
}
