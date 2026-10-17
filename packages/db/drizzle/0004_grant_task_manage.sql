-- New permission task.manage (phase 1, step 5) for the owner role of companies that already exist.
-- System role grants are copied into each tenant at signup, so new grants need a data migration.
INSERT INTO role_grants (tenant_id, role_id, permission, scope)
SELECT r.tenant_id, r.id, 'task.manage', 'tenant'
FROM roles r
WHERE r.key = 'owner' AND r.is_system
ON CONFLICT DO NOTHING;
