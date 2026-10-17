-- Work core (phase 1, step 5): grants and forced tenant isolation for the new tables (ADR 0002).

GRANT SELECT, INSERT, UPDATE, DELETE ON projects, project_members, tasks, task_collaborators, comments, daily_plan_items TO madar_app;
--> statement-breakpoint
-- Activity history is append-only for the application.
GRANT SELECT, INSERT ON activities TO madar_app;
--> statement-breakpoint
-- The outbox: the app writes events; the publisher (same role, later) marks them published.
GRANT SELECT, INSERT, UPDATE ON domain_events TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('projects');
--> statement-breakpoint
SELECT app.enable_tenant_rls('project_members');
--> statement-breakpoint
SELECT app.enable_tenant_rls('tasks');
--> statement-breakpoint
SELECT app.enable_tenant_rls('task_collaborators');
--> statement-breakpoint
SELECT app.enable_tenant_rls('comments');
--> statement-breakpoint
SELECT app.enable_tenant_rls('activities');
--> statement-breakpoint
SELECT app.enable_tenant_rls('daily_plan_items');
--> statement-breakpoint
SELECT app.enable_tenant_rls('domain_events');
