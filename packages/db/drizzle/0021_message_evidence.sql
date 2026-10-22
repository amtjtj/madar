ALTER TYPE "public"."evidence_kind" ADD VALUE 'message';--> statement-breakpoint
-- New permission chat.export (plan phase-2-step-15c) for the owner and admin roles of companies
-- that already exist (system role grants are copied only at signup).
INSERT INTO role_grants (tenant_id, role_id, permission, scope)
SELECT r.tenant_id, r.id, 'chat.export', 'tenant'
FROM roles r
WHERE r.key IN ('owner', 'admin') AND r.is_system
ON CONFLICT DO NOTHING;
