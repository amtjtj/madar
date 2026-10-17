import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, requiresTwoFactor, type Permission } from '@madar/shared';
import { fromNodeHeaders } from 'better-auth/node';

import {
  PERMISSION_KEY,
  PUBLIC_KEY,
  SESSION_ONLY_KEY,
  type MadarRequest,
  type SessionContext,
} from '../common/context.js';
import { ApiError, forbidden, unauthenticated } from '../common/errors.js';
import { AccountsService } from './accounts.service.js';
import type { Auth } from './auth.js';
import { AUTH } from './auth.tokens.js';
import { TenantContextService } from './tenant-context.service.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global guard, in order: session → tenant membership → tenant status → security gate
 * (password change, admin 2FA) → route permission. UI hiding is never the protection.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH) private readonly auth: Auth,
    private readonly tenants: TenantContextService,
    private readonly accounts: AccountsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<MadarRequest>();
    const result = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!result) throw unauthenticated();

    const user = result.user as typeof result.user & {
      username?: string | null;
      twoFactorEnabled?: boolean | null;
      mustChangePassword?: boolean | null;
    };
    const session: SessionContext = {
      user: {
        id: user.id,
        name: user.name,
        username: user.username ?? null,
        twoFactorEnabled: Boolean(user.twoFactorEnabled),
        mustChangePassword: Boolean(user.mustChangePassword),
      },
      sessionToken: result.session.token,
      activeTenantId: (result.session as { activeTenantId?: string | null }).activeTenantId ?? null,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    };
    req.madar = { session };

    if (this.reflector.getAllAndOverride<boolean>(SESSION_ONLY_KEY, targets)) return true;

    // Tenant: the session's active tenant, or the only one the user belongs to.
    let tenantId = session.activeTenantId;
    if (!tenantId) {
      const memberships = await this.tenants.memberships(session.user.id);
      const active = memberships.filter((m) => m.memberStatus === 'active');
      if (active.length === 0 && memberships.length > 0) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'member_suspended', 'Membership is not active');
      }
      if (active.length !== 1 || !active[0]) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'tenant_selection_required',
          'Choose a company first',
        );
      }
      tenantId = active[0].tenantId;
      await this.accounts.setActiveTenant(session.sessionToken, tenantId);
    }

    const tenant = await this.tenants.tenantStatus(tenantId);
    const member = tenant ? await this.tenants.loadMember(tenantId, session.user.id) : null;
    if (!tenant || !member) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'not_a_member', 'Not a member of this company');
    }
    if (member.status !== 'active') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'member_suspended', 'Membership is not active');
    }
    if (tenant.status === 'locked') {
      throw new ApiError(HttpStatus.LOCKED, 'tenant_locked', 'Company account is locked');
    }
    if (tenant.status === 'read_only' && WRITE_METHODS.has(req.method)) {
      throw new ApiError(HttpStatus.LOCKED, 'tenant_read_only', 'Company account is read-only');
    }

    // Security gate: nothing else until the password is changed and admins have 2FA.
    if (session.user.mustChangePassword) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'password_change_required',
        'Change your password first',
      );
    }
    if (requiresTwoFactor(member.actor.roles) && !session.user.twoFactorEnabled) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'two_factor_setup_required',
        'Set up two-factor authentication first',
      );
    }

    req.madar.tenant = {
      ...session,
      tenantId,
      tenantStatus: tenant.status,
      memberId: member.memberId,
      actor: member.actor,
    };

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (permission && !can(member.actor, permission)) throw forbidden();
    return true;
  }
}
