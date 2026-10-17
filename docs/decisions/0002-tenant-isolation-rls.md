# 0002 — Tenant isolation with PostgreSQL RLS

- Status: Accepted
- Date: 2026-10-17

## Context
Madar is multi-tenant and the pilot customer is a fintech. A data leak between companies is the worst possible failure. Large tenants must later be movable to a dedicated database without code changes.

## Decision
- One database, one schema. Every data-plane table (including join tables) has `tenant_id uuid NOT NULL DEFAULT app.current_tenant_id()`.
- RLS `ENABLE` + `FORCE` on every data-plane table, policy `tenant_id = app.current_tenant_id()` for both `USING` and `WITH CHECK`.
- The tenant is set per transaction with `set_config('app.tenant_id', $1, true)` inside `withTenant()` in `packages/db`. Unset tenant → `NULL` → zero rows (fail closed). Compatible with PgBouncer transaction pooling.
- DB roles: `madar_owner` (migrations), `madar_app` (API/workers, `NOBYPASSRLS`, not table owner), `madar_auth` (Better Auth tables only).
- Composite foreign keys `(tenant_id, x_id) → (tenant_id, id)` as a second line of defense. All indexes start with `tenant_id`.
- IDs are UUIDv7.
- Control plane (`tenants`, `tenant_routes`, `users`, auth tables, `platform_admins`) has no `tenant_id`; cross-tenant reads only through narrow `SECURITY DEFINER` functions.
- Connections are obtained through `getPoolForTenant(tenantId)` (single pool for now) so tenants can be routed to dedicated clusters later.
- Redis keys via `tenantKey()`, BullMQ jobs carry `tenantId`, object keys prefixed `tenants/{tenantId}/`, Socket.IO rooms prefixed by tenant.
- Tests: per-table isolation test + a catalog meta-test failing CI if any table with `tenant_id` lacks forced RLS and a policy.

## Alternatives considered
- Schema per tenant: strong isolation but migrations scale with tenant count and pooling is harder.
- Database per tenant from day one: operationally heavy for many small tenants.
- Application-level filtering only: a single forgotten `WHERE` leaks data.

## Consequences
- All DB access must go through `withTenant()` (enforced by lint).
- Slight overhead of a transaction per request; acceptable.

## Implementation notes (phase 1, step 4)
- `madar_auth` is **not** created yet: `madar_app` reads/writes the Better Auth tables, which are control-plane tables without RLS. Revisit when the API is split into services.
- `madar_platform` (NOLOGIN) owns the only cross-tenant function, `app.list_memberships(user_id)`, through a `FOR SELECT TO madar_platform` policy on `members`. `madar_app` cannot assume that role.
- `db:migrate` creates or updates `madar_app` (LOGIN, NOBYPASSRLS, NOSUPERUSER) from `APP_DATABASE_URL` before applying migrations; the API and tests connect with that URL only.
- Every new data-plane table must call `select app.enable_tenant_rls('<table>')` in its migration; the catalog meta-test fails CI otherwise.
- Composite foreign keys never use `ON DELETE SET NULL` (it would null `tenant_id`); members are never hard-deleted (`status = left`), departments are archived.
