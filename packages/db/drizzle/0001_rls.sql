-- Tenant isolation (ADR 0002): database roles, grants, forced RLS, append-only audit log,
-- and the narrow cross-tenant lookup used at login.
--
-- Roles
--   madar_app       API and workers. Not the table owner, NOBYPASSRLS. Created/password-set by
--                   src/migrate.ts from APP_DATABASE_URL; created NOLOGIN here if missing.
--   madar_platform  NOLOGIN. Owns SECURITY DEFINER functions that must read across tenants.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madar_app') THEN
    CREATE ROLE madar_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madar_platform') THEN
    CREATE ROLE madar_platform NOLOGIN NOBYPASSRLS;
  END IF;
  -- The migrating role must be able to hand function ownership to madar_platform.
  BEGIN
    EXECUTE format('GRANT madar_platform TO %I', current_user);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- already a member, or a superuser
  END;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public, app TO madar_app, madar_platform;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_tenant_id(), app.current_member_id(), app.current_user_id() TO madar_app, madar_platform;
--> statement-breakpoint

-- Control plane (no RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, accounts, verifications, two_factors TO madar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenants TO madar_app;
--> statement-breakpoint

-- Data plane
GRANT SELECT, INSERT, UPDATE, DELETE ON members, departments, department_memberships, roles, role_grants, member_roles TO madar_app;
--> statement-breakpoint
-- The audit log is read-only for the app; rows are added only through app.append_audit().
GRANT SELECT ON audit_logs TO madar_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_logs FROM madar_app;
--> statement-breakpoint

-- Forced RLS helper: every data-plane table gets the same tenant_isolation policy.
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(tbl regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
    tbl
  );
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.enable_tenant_rls(regclass) FROM PUBLIC;
--> statement-breakpoint

SELECT app.enable_tenant_rls('members');
--> statement-breakpoint
SELECT app.enable_tenant_rls('departments');
--> statement-breakpoint
SELECT app.enable_tenant_rls('department_memberships');
--> statement-breakpoint
SELECT app.enable_tenant_rls('roles');
--> statement-breakpoint
SELECT app.enable_tenant_rls('role_grants');
--> statement-breakpoint
SELECT app.enable_tenant_rls('member_roles');
--> statement-breakpoint
SELECT app.enable_tenant_rls('audit_logs');
--> statement-breakpoint

-- Login needs "which tenants is this user a member of?" before any tenant is chosen.
-- madar_platform may read members for that purpose only (through the function below).
GRANT SELECT ON members, tenants TO madar_platform;
--> statement-breakpoint
CREATE POLICY platform_membership_lookup ON members FOR SELECT TO madar_platform USING (true);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.list_memberships(p_user_id uuid)
  RETURNS TABLE (
    tenant_id uuid,
    tenant_name text,
    tenant_slug text,
    tenant_status tenant_status,
    member_id uuid,
    member_status member_status
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.name, t.slug, t.status, m.id, m.status
    FROM members m
    JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user_id
    ORDER BY t.name
  $$;
--> statement-breakpoint
ALTER FUNCTION app.list_memberships(uuid) OWNER TO madar_platform;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.list_memberships(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.list_memberships(uuid) TO madar_app;
--> statement-breakpoint

-- Append-only, hash-chained audit log. Each tenant has its own chain:
--   hash = sha256(prev_hash | tenant | seq | actor | action | subject | before | after | time)
-- A per-tenant advisory lock serializes appends so the chain never forks.
CREATE OR REPLACE FUNCTION app.append_audit(
  p_action text,
  p_subject_type text,
  p_subject_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_ip text,
  p_user_agent text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_tenant uuid := app.current_tenant_id();
  v_user uuid := app.current_user_id();
  v_member uuid := app.current_member_id();
  v_id uuid := gen_random_uuid();
  v_created timestamptz := clock_timestamp();
  v_prev_hash text;
  v_prev_seq bigint;
  v_seq bigint;
  v_hash text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'append_audit requires a tenant context';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || v_tenant::text, 0));

  SELECT a.hash, a.seq INTO v_prev_hash, v_prev_seq
  FROM audit_logs a
  WHERE a.tenant_id = v_tenant
  ORDER BY a.seq DESC
  LIMIT 1;

  v_seq := coalesce(v_prev_seq, 0) + 1;
  v_hash := app.audit_hash(
    v_prev_hash, v_tenant, v_seq, v_user, v_member, p_action, p_subject_type, p_subject_id,
    p_before, p_after, v_created
  );

  INSERT INTO audit_logs (
    id, tenant_id, seq, actor_user_id, actor_member_id, action, subject_type, subject_id,
    before, after, ip, user_agent, prev_hash, hash, created_at
  ) VALUES (
    v_id, v_tenant, v_seq, v_user, v_member, p_action, p_subject_type, p_subject_id,
    p_before, p_after, p_ip, p_user_agent, v_prev_hash, v_hash, v_created
  );

  RETURN v_id;
END
$$;
--> statement-breakpoint

-- Shared by append_audit and the chain verifier so both hash exactly the same way.
CREATE OR REPLACE FUNCTION app.audit_hash(
  p_prev_hash text,
  p_tenant uuid,
  p_seq bigint,
  p_user uuid,
  p_member uuid,
  p_action text,
  p_subject_type text,
  p_subject_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_created timestamptz
) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT encode(sha256(convert_to(concat_ws('|',
      coalesce(p_prev_hash, ''),
      p_tenant::text,
      p_seq::text,
      coalesce(p_user::text, ''),
      coalesce(p_member::text, ''),
      p_action,
      p_subject_type,
      coalesce(p_subject_id::text, ''),
      coalesce(p_before::text, ''),
      coalesce(p_after::text, ''),
      to_char(p_created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
    ), 'UTF8')), 'hex')
  $$;
--> statement-breakpoint

-- Returns the first broken link in the current tenant's chain, or no rows if intact.
CREATE OR REPLACE FUNCTION app.verify_audit_chain()
  RETURNS TABLE (seq bigint, problem text)
  LANGUAGE sql STABLE
  AS $$
    WITH ordered AS (
      SELECT a.*, lag(a.hash) OVER (ORDER BY a.seq) AS expected_prev, lag(a.seq) OVER (ORDER BY a.seq) AS prev_seq
      FROM audit_logs a
      WHERE a.tenant_id = app.current_tenant_id()
    )
    SELECT o.seq,
      CASE
        WHEN o.seq <> coalesce(o.prev_seq, 0) + 1 THEN 'gap in sequence'
        WHEN o.prev_hash IS DISTINCT FROM o.expected_prev THEN 'prev_hash does not match previous row'
        ELSE 'hash does not match row contents'
      END
    FROM ordered o
    WHERE o.seq <> coalesce(o.prev_seq, 0) + 1
       OR o.prev_hash IS DISTINCT FROM o.expected_prev
       OR o.hash <> app.audit_hash(o.prev_hash, o.tenant_id, o.seq, o.actor_user_id, o.actor_member_id,
            o.action, o.subject_type, o.subject_id, o.before, o.after, o.created_at)
    ORDER BY o.seq
    LIMIT 1
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.append_audit(text, text, uuid, jsonb, jsonb, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.append_audit(text, text, uuid, jsonb, jsonb, text, text) TO madar_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.audit_hash(text, uuid, bigint, uuid, uuid, text, text, uuid, jsonb, jsonb, timestamptz) TO madar_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.verify_audit_chain() TO madar_app;
