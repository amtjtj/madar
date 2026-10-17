import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** UUIDv7 primary key: time-ordered and globally unique (safe when moving a tenant between databases). */
export const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** Tenant column for data-plane tables. Defaults to the tenant set on the transaction (RLS). */
export const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .default(sql`app.current_tenant_id()`);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export { uuidv7 };
