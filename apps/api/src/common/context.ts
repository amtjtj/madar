import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Actor, Permission } from '@madar/shared';
import type { Request } from 'express';

export interface SessionUser {
  id: string;
  name: string;
  username: string | null;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
}

export interface SessionContext {
  user: SessionUser;
  sessionToken: string;
  activeTenantId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface TenantContext extends SessionContext {
  tenantId: string;
  tenantStatus: 'active' | 'read_only' | 'locked';
  memberId: string;
  actor: Actor;
}

export interface MadarRequest extends Request {
  madar?: { session?: SessionContext; tenant?: TenantContext };
}

/** No session needed (health, signup). */
export const PUBLIC_KEY = 'madar:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** A session is enough: no tenant, and allowed while a password change or 2FA setup is pending. */
export const SESSION_ONLY_KEY = 'madar:session-only';
export const SessionOnly = () => SetMetadata(SESSION_ONLY_KEY, true);

/** Tenant-level permission required for the route (resource checks happen in services). */
export const PERMISSION_KEY = 'madar:permission';
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

export const Session = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionContext => {
  const session = ctx.switchToHttp().getRequest<MadarRequest>().madar?.session;
  if (!session) throw new Error('Session context missing: route is @Public?');
  return session;
});

export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const tenant = ctx.switchToHttp().getRequest<MadarRequest>().madar?.tenant;
  if (!tenant) throw new Error('Tenant context missing: route is @SessionOnly or @Public?');
  return tenant;
});
