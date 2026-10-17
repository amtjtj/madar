-- Background work and notifications (phase 1, step 6): grants, forced tenant isolation and the
-- two cross-tenant functions the worker needs (ADR 0002, ADR 0006).

GRANT SELECT, INSERT, UPDATE ON work_calendars, notifications, notification_preferences TO madar_app;
--> statement-breakpoint
-- Idempotency records are written once and never changed by the application.
GRANT SELECT, INSERT ON processed_events TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('work_calendars');
--> statement-breakpoint
SELECT app.enable_tenant_rls('notifications');
--> statement-breakpoint
SELECT app.enable_tenant_rls('notification_preferences');
--> statement-breakpoint
SELECT app.enable_tenant_rls('processed_events');
--> statement-breakpoint

-- The outbox relay reads unpublished events of every tenant, through the functions below only.
CREATE INDEX IF NOT EXISTS domain_events_relay_idx ON domain_events (occurred_at) WHERE published_at IS NULL;
--> statement-breakpoint
GRANT SELECT, UPDATE (published_at) ON domain_events TO madar_platform;
--> statement-breakpoint
CREATE POLICY platform_relay_select ON domain_events FOR SELECT TO madar_platform USING (true);
--> statement-breakpoint
CREATE POLICY platform_relay_update ON domain_events FOR UPDATE TO madar_platform USING (true) WITH CHECK (true);
--> statement-breakpoint

-- Locks a batch of unpublished events for the calling transaction (other relays skip them).
-- The relay enqueues the jobs, then calls app.mark_events_published in the same transaction;
-- a crash before commit releases the locks and the events are relayed again (at least once).
-- p_tenants limits the batch to some tenants (tests run relays side by side); NULL means all.
CREATE OR REPLACE FUNCTION app.lock_unpublished_events(p_batch int, p_tenants uuid[] DEFAULT NULL)
  RETURNS TABLE (
    id uuid,
    tenant_id uuid,
    type text,
    version smallint,
    payload jsonb,
    actor_id uuid,
    occurred_at timestamptz
  )
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT e.id, e.tenant_id, e.type, e.version, e.payload, e.actor_id, e.occurred_at
    FROM domain_events e
    WHERE e.published_at IS NULL
      AND (p_tenants IS NULL OR e.tenant_id = ANY (p_tenants))
    ORDER BY e.occurred_at
    LIMIT least(greatest(p_batch, 1), 500)
    FOR UPDATE SKIP LOCKED
  $$;
--> statement-breakpoint
ALTER FUNCTION app.lock_unpublished_events(int, uuid[]) OWNER TO madar_platform;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.lock_unpublished_events(int, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.lock_unpublished_events(int, uuid[]) TO madar_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.mark_events_published(p_ids uuid[]) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    UPDATE domain_events SET published_at = clock_timestamp()
    WHERE id = ANY (p_ids) AND published_at IS NULL
  $$;
--> statement-breakpoint
ALTER FUNCTION app.mark_events_published(uuid[]) OWNER TO madar_platform;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.mark_events_published(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.mark_events_published(uuid[]) TO madar_app;
--> statement-breakpoint

-- Scheduled jobs (due-date reminders) iterate over active tenants: ids and time zones only.
CREATE OR REPLACE FUNCTION app.list_active_tenants()
  RETURNS TABLE (id uuid, timezone text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.timezone FROM tenants t WHERE t.status = 'active' ORDER BY t.id
  $$;
--> statement-breakpoint
ALTER FUNCTION app.list_active_tenants() OWNER TO madar_platform;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.list_active_tenants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.list_active_tenants() TO madar_app;
