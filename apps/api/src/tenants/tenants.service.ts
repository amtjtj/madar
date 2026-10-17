import { timingSafeEqual } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  appendAudit,
  schema as s,
  setActor,
  uuidv7,
  withTenant,
  type DbHandle,
  type Tx,
} from '@madar/db';
import {
  SYSTEM_ROLE_GRANTS,
  SYSTEM_ROLES,
  type SignupRequest,
  type SystemRole,
} from '@madar/shared';
import { eq } from 'drizzle-orm';

import { AccountsService } from '../auth/accounts.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ApiError } from '../common/errors.js';
import { DB_HANDLE } from '../database/tokens.js';

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Creates the system roles of a new tenant with their default grants. Returns role ids by key. */
export async function createSystemRoles(tx: Tx): Promise<Record<SystemRole, string>> {
  const rows = await tx
    .insert(s.roles)
    .values(SYSTEM_ROLES.map((key) => ({ key, name: key, isSystem: true })))
    .returning({ id: s.roles.id, key: s.roles.key });
  const ids = Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<SystemRole, string>;
  await tx.insert(s.roleGrants).values(
    SYSTEM_ROLES.flatMap((key) =>
      SYSTEM_ROLE_GRANTS[key].map(([permission, scope]) => ({
        roleId: ids[key],
        permission,
        scope,
      })),
    ),
  );
  return ids;
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
    private readonly accounts: AccountsService,
  ) {}

  /** Registers a company and its owner. The owner sets up 2FA at first sign-in. */
  async signup(input: SignupRequest, meta: { ip: string | null; userAgent: string | null }) {
    const code = this.env.TENANT_SIGNUP_CODE;
    if (code && !sameSecret(input.signupCode ?? '', code)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'signup_code_invalid', 'Invalid signup code');
    }

    const [slugTaken] = await this.handle.db
      .select({ id: s.tenants.id })
      .from(s.tenants)
      .where(eq(s.tenants.slug, input.slug));
    if (slugTaken)
      throw new ApiError(HttpStatus.CONFLICT, 'slug_taken', 'Company identifier is taken');
    if (await this.accounts.findByUsername(input.username)) {
      throw new ApiError(HttpStatus.CONFLICT, 'username_taken', 'Username is taken');
    }

    const user = await this.accounts.createUser({
      name: input.adminName,
      username: input.username,
      password: input.password,
      mustChangePassword: false,
    });

    const tenantId = uuidv7();
    try {
      await withTenant(this.handle.db, { tenantId, userId: user.id }, async (tx) => {
        await tx
          .insert(s.tenants)
          .values({ id: tenantId, name: input.companyName, slug: input.slug });
        const roleIds = await createSystemRoles(tx);
        const [member] = await tx
          .insert(s.members)
          .values({ userId: user.id, displayName: input.adminName })
          .returning({ id: s.members.id });
        if (!member) throw new Error('member insert failed');
        await tx.insert(s.memberRoles).values({ memberId: member.id, roleId: roleIds.owner });
        // Record the owner as the actor from here on.
        await setActor(tx, member.id);
        const audit = { ip: meta.ip, userAgent: meta.userAgent };
        await appendAudit(tx, {
          ...audit,
          action: 'tenant.created',
          subjectType: 'tenant',
          subjectId: tenantId,
          after: { name: input.companyName, slug: input.slug },
        });
        await appendAudit(tx, {
          ...audit,
          action: 'member.created',
          subjectType: 'member',
          subjectId: member.id,
          after: { displayName: input.adminName, username: input.username },
        });
        await appendAudit(tx, {
          ...audit,
          action: 'member.roles_changed',
          subjectType: 'member',
          subjectId: member.id,
          before: { roles: [] },
          after: { roles: ['owner'] },
        });
      });
    } catch (error) {
      // Undo the identity so a retry can reuse the username.
      await this.accounts.deleteUser(user.id).catch((e: unknown) => this.logger.error(e));
      if (isUniqueViolation(error)) {
        throw new ApiError(HttpStatus.CONFLICT, 'slug_taken', 'Company identifier is taken');
      }
      throw error;
    }

    return { tenantId, slug: input.slug, username: input.username };
  }
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return (error as { code?: string })?.code === '23505' || cause?.code === '23505';
}
