import { Inject, Injectable } from '@nestjs/common';
import { appendAudit, withTenant, type AuditEntry, type DbHandle, type Tx } from '@madar/db';

import type { TenantContext } from '../common/context.js';
import { DB_HANDLE } from './tokens.js';

/** Tenant-scoped transactions for request handlers; the actor is recorded for the audit log. */
@Injectable()
export class TenantDb {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  run<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(
      this.handle.db,
      { tenantId: ctx.tenantId, memberId: ctx.memberId, userId: ctx.user.id },
      fn,
    );
  }

  /** Appends an audit entry carrying the request's IP and user agent. */
  audit(tx: Tx, ctx: TenantContext, entry: Omit<AuditEntry, 'ip' | 'userAgent'>): Promise<string> {
    return appendAudit(tx, { ...entry, ip: ctx.ip, userAgent: ctx.userAgent });
  }
}
