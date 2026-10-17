import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import {
  changePasswordRequest,
  setActiveTenantRequest,
  type ChangePasswordRequest,
  type MeResponse,
  type SetActiveTenantRequest,
} from '@madar/shared';
import { requiresTwoFactor, scopeFor, PERMISSIONS } from '@madar/shared';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { Req, Res } from '@nestjs/common';

import { AccountsService } from '../auth/accounts.service.js';
import type { Auth } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import { Session, SessionOnly, type SessionContext } from '../common/context.js';
import { ApiError, forbidden } from '../common/errors.js';
import { ZodPipe } from '../common/zod.pipe.js';

@Controller('me')
@SessionOnly()
export class MeController {
  constructor(
    private readonly tenants: TenantContextService,
    private readonly accounts: AccountsService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  /** Who am I, where am I, and what must I do before using the app. */
  @Get()
  async me(@Session() session: SessionContext): Promise<MeResponse> {
    const memberships = (await this.tenants.memberships(session.user.id)).filter(
      (m) => m.memberStatus === 'active',
    );
    let tenantId = session.activeTenantId;
    if (!tenantId && memberships.length === 1 && memberships[0]) {
      tenantId = memberships[0].tenantId;
      await this.accounts.setActiveTenant(session.sessionToken, tenantId);
    }
    const tenant = tenantId ? await this.tenants.tenantStatus(tenantId) : null;
    const member = tenant ? await this.tenants.loadMember(tenant.id, session.user.id) : null;
    const roles = member?.actor.roles ?? [];
    const twoFactorRequired = requiresTwoFactor(roles);

    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        username: session.user.username,
        twoFactorEnabled: session.user.twoFactorEnabled,
      },
      memberships: memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenantName,
        tenantSlug: m.tenantSlug,
      })),
      tenant:
        tenant && member
          ? {
              id: tenant.id,
              name: tenant.name,
              slug: tenant.slug,
              status: tenant.status,
              timezone: tenant.timezone,
            }
          : null,
      member: member
        ? {
            id: member.memberId,
            displayName: member.displayName,
            title: member.title,
            roles,
            departments: member.actor.departments,
            permissions: Object.fromEntries(
              PERMISSIONS.flatMap((p) => {
                const scope = scopeFor(member.actor, p);
                return scope ? [[p, scope]] : [];
              }),
            ),
          }
        : null,
      pending: {
        passwordChange: session.user.mustChangePassword,
        twoFactorSetup: twoFactorRequired && !session.user.twoFactorEnabled,
        tenantSelection: !tenant && memberships.length > 1,
      },
    };
  }

  @Post('active-tenant')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setActiveTenant(
    @Session() session: SessionContext,
    @Body(new ZodPipe(setActiveTenantRequest)) body: SetActiveTenantRequest,
  ): Promise<void> {
    const memberships = await this.tenants.memberships(session.user.id);
    const membership = memberships.find(
      (m) => m.tenantId === body.tenantId && m.memberStatus === 'active',
    );
    if (!membership) throw forbidden('Not a member of this company');
    await this.accounts.setActiveTenant(session.sessionToken, body.tenantId);
  }

  /** Changes the password through Better Auth and clears the "must change" flag. */
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Session() session: SessionContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(changePasswordRequest)) body: ChangePasswordRequest,
  ): Promise<void> {
    try {
      // Revoking sessions replaces the current one too, so forward the new session cookie.
      const { headers } = await this.auth.api.changePassword({
        headers: fromNodeHeaders(req.headers),
        body: {
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
          revokeOtherSessions: true,
        },
        returnHeaders: true,
      });
      const cookies = headers.getSetCookie();
      if (cookies.length) res.setHeader('set-cookie', cookies);
    } catch (error) {
      if (error instanceof APIError) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_password', error.message);
      }
      throw error;
    }
    await this.accounts.clearMustChangePassword(session.user.id);
  }
}
