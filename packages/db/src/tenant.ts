import { sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { activities, domainEvents } from './schema/work.js';

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

/** Writes a domain event to the outbox in the caller's transaction (architecture §5). */
export async function emitEvent(
  tx: Tx,
  type: string,
  payload: Record<string, unknown>,
  actorId: string | null,
): Promise<void> {
  await tx.insert(domainEvents).values({ type, payload, actorId });
}

export type ActivityChanges = Record<string, { from: unknown; to: unknown }>;

/** Appends a user-visible history entry (not the security audit log). */
export async function recordActivity(
  tx: Tx,
  entry: {
    subjectType: string;
    subjectId: string;
    actorId: string | null;
    verb: string;
    changes?: ActivityChanges | null;
  },
): Promise<void> {
  await tx.insert(activities).values({ ...entry, changes: entry.changes ?? null });
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

/** An outbox event as the relay sees it (from the platform function, minimal columns). */
export interface OutboxEvent {
  id: string;
  tenantId: string;
  type: string;
  version: number;
  payload: Record<string, unknown>;
  actorId: string | null;
  occurredAt: Date;
}

/**
 * Locks up to `batch` unpublished events of any tenant for the calling transaction (ADR 0006).
 * Call `markEventsPublished` in the same transaction once they are enqueued.
 */
export async function lockUnpublishedEvents(tx: Tx, batch: number): Promise<OutboxEvent[]> {
  const result = await tx.execute<{
    id: string;
    tenant_id: string;
    type: string;
    version: number;
    payload: Record<string, unknown>;
    actor_id: string | null;
    occurred_at: string | Date;
  }>(sql`select * from app.lock_unpublished_events(${batch}::int)`);
  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    version: Number(row.version),
    payload: row.payload,
    actorId: row.actor_id,
    occurredAt: new Date(row.occurred_at),
  }));
}

export async function markEventsPublished(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(
    sql`select app.mark_events_published(${sql.raw(
      `ARRAY[${ids.map((id) => `'${id.replace(/[^0-9a-f-]/gi, '')}'`).join(',')}]`,
    )}::uuid[])`,
  );
}

/** Active tenants (id and time zone only), for scheduled jobs. */
export async function listActiveTenants(
  db: Database,
): Promise<Array<{ id: string; timezone: string }>> {
  const result = await db.execute<{ id: string; timezone: string }>(
    sql`select * from app.list_active_tenants()`,
  );
  return result.rows;
}
