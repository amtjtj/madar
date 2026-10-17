# API (apps/api) and database (packages/db)

Implementation rules for the NestJS API and the Drizzle schema. The root `CLAUDE.md` (golden rules, multi-tenancy and security principles, workflow, commands) still applies.

## Data access and tenant isolation
- All tenant data access goes through `withTenant()` from `@madar/db` (API: `TenantDb.run(ctx, …)`); raw `pg` imports are lint errors in the API.
- New data-plane tables: composite `(tenant_id, x)` foreign keys and `select app.enable_tenant_rls('<table>')` in the migration (the catalog meta-test enforces it).
- Sensitive changes call `TenantDb.audit()` inside the same transaction (ADR 0009).
- API errors carry codes only (`{ error: { code } }`); the web maps them to Persian in `apps/web/src/lib/errors.ts` and `errors.*` strings.
- System-role grants are copied into each tenant at signup: adding a permission to `SYSTEM_ROLE_GRANTS` also needs a data migration for existing tenants (see `0004_grant_task_manage.sql`).
- Work visibility (who sees which task/project) lives in `apps/api/src/work/access.ts` as SQL conditions; reuse them, never filter in memory (ADR 0010).
