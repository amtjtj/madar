-- The worker gets its own role (ADR 0011): only it may call the cross-tenant outbox and scheduling
-- functions; HTTP requests (madar_app) cannot. It inherits the app role's table privileges and is
-- bound by the same RLS policies. `pnpm db:migrate` gives it a login from WORKER_DATABASE_URL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madar_worker') THEN
    CREATE ROLE madar_worker NOLOGIN NOBYPASSRLS NOSUPERUSER;
  END IF;
END
$$;
--> statement-breakpoint
GRANT madar_app TO madar_worker;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.lock_unpublished_events(int, uuid[]) FROM madar_app;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.mark_events_published(uuid[]) FROM madar_app;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.list_active_tenants() FROM madar_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.lock_unpublished_events(int, uuid[]) TO madar_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.mark_events_published(uuid[]) TO madar_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.list_active_tenants() TO madar_worker;
--> statement-breakpoint
-- Event payloads carry ids (and other non-sensitive keys) only: the worker reads them across
-- tenants, so titles, comments or personal data never go into domain_events.payload.
COMMENT ON COLUMN domain_events.payload IS 'ids only; read across tenants by the worker (ADR 0011)';
