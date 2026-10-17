import { sql } from 'drizzle-orm';

import type { Database } from './client.js';

/** The transaction handle passed to tenant-scoped work. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TenantScope {
  tenantId: string;
  /** Acting member, recorded by the audit log. */
  memberId?: string | null;
  /** Acting user (control plane), recorded by the audit log. */
  userId?: string | null;
}

/**
 * Runs `fn` in a transaction where RLS sees only `tenantId`. The settings are transaction-local
 * (`set_config(..., true)`), so they never leak to the next request on a pooled connection.
 * This is the only way application code should touch data-plane tables.
 */
export async function withTenant<T>(
  db: Database,
  scope: TenantScope,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${scope.tenantId}, true),
      set_config('app.member_id', ${scope.memberId ?? ''}, true),
      set_config('app.user_id', ${scope.userId ?? ''}, true)`);
    return fn(tx);
  });
}

/** Sets the acting member for the rest of the transaction (e.g. right after creating them). */
export async function setActor(tx: Tx, memberId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.member_id', ${memberId}, true)`);
}

export interface AuditEntry {
  action: string;
  subjectType: string;
  subjectId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** Appends to the tenant's hash-chained audit log (inside a withTenant transaction). */
export async function appendAudit(tx: Tx, entry: AuditEntry): Promise<string> {
  const json = (value: unknown) =>
    value === undefined || value === null ? null : JSON.stringify(value);
  const result = await tx.execute<{ id: string }>(sql`select app.append_audit(
    ${entry.action},
    ${entry.subjectType},
    ${entry.subjectId ?? null}::uuid,
    ${json(entry.before)}::jsonb,
    ${json(entry.after)}::jsonb,
    ${entry.ip ?? null},
    ${entry.userAgent ?? null}
  ) as id`);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('append_audit returned no id');
  return id;
}

export interface Membership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: 'active' | 'read_only' | 'locked';
  memberId: string;
  memberStatus: 'active' | 'suspended' | 'left';
}

/** Tenants a user belongs to (the one sanctioned cross-tenant read, used at login). */
export async function listMemberships(db: Database, userId: string): Promise<Membership[]> {
  const result = await db.execute<{
    tenant_id: string;
    tenant_name: string;
    tenant_slug: string;
    tenant_status: Membership['tenantStatus'];
    member_id: string;
    member_status: Membership['memberStatus'];
  }>(sql`select * from app.list_memberships(${userId}::uuid)`);
  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    tenantStatus: row.tenant_status,
    memberId: row.member_id,
    memberStatus: row.member_status,
  }));
}
