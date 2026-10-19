CREATE TYPE "public"."task_source" AS ENUM('personal', 'assigned', 'request', 'meeting');--> statement-breakpoint
CREATE TABLE "member_task_order" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"sort_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_task_order_tenant_id_member_id_task_id_pk" PRIMARY KEY("tenant_id","member_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "daily_plan_items" ALTER COLUMN "sort_key" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "daily_plan_items" ALTER COLUMN "sort_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source" "task_source";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_member_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_ceo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member_task_order" ADD CONSTRAINT "member_task_order_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_task_order" ADD CONSTRAINT "member_task_order_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_task_order" ADD CONSTRAINT "member_task_order_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_task_order_task_idx" ON "member_task_order" USING btree ("tenant_id","task_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_member_fk" FOREIGN KEY ("tenant_id","source_member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_tenant_source_idx" ON "tasks" USING btree ("tenant_id","source");--> statement-breakpoint

-- Task source and personal order (phase 2a, step 10a; ADR 0017).
GRANT SELECT, INSERT, UPDATE, DELETE ON member_task_order TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('member_task_order');
--> statement-breakpoint
-- Today plans become «placed by score» until their member orders them by hand.
UPDATE daily_plan_items SET sort_key = NULL;
--> statement-breakpoint
-- Existing tasks: the same rule as deriveTaskSource in packages/shared, with the creator as the
-- person who set the assignee.
WITH RECURSIVE chain (tenant_id, member_id, manager_id, depth) AS (
  SELECT tenant_id, id, manager_id, 1 FROM members WHERE manager_id IS NOT NULL
  UNION ALL
  SELECT c.tenant_id, c.member_id, m.manager_id, c.depth + 1
  FROM chain c
  JOIN members m ON m.tenant_id = c.tenant_id AND m.id = c.manager_id
  WHERE m.manager_id IS NOT NULL AND c.depth < 20
),
derived AS (
  SELECT
    t.tenant_id,
    t.id,
    CASE
      WHEN t.reporter_id = t.assignee_id THEN 'personal'
      WHEN EXISTS (
        SELECT 1 FROM chain c
        WHERE c.tenant_id = t.tenant_id AND c.member_id = t.assignee_id AND c.manager_id = t.reporter_id
      ) OR EXISTS (
        SELECT 1 FROM department_memberships dm
        WHERE dm.tenant_id = t.tenant_id AND dm.department_id = t.department_id
          AND dm.member_id = t.reporter_id AND dm.dept_role IN ('head', 'manager')
      ) THEN 'assigned'
      ELSE 'request'
    END::task_source AS source
  FROM tasks t
  WHERE t.assignee_id IS NOT NULL AND t.source IS NULL
)
UPDATE tasks t
SET
  source = d.source,
  source_member_id = t.reporter_id,
  source_ceo = d.source = 'assigned' AND EXISTS (
    SELECT 1 FROM members m
    JOIN member_roles mr ON mr.tenant_id = m.tenant_id AND mr.member_id = m.id
    JOIN roles r ON r.tenant_id = mr.tenant_id AND r.id = mr.role_id
    WHERE m.tenant_id = t.tenant_id AND m.id = t.reporter_id AND m.manager_id IS NULL
      AND r.key IN ('owner', 'executive')
  )
FROM derived d
WHERE t.tenant_id = d.tenant_id AND t.id = d.id;
