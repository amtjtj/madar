CREATE TYPE "public"."task_progress_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
ALTER TYPE "public"."project_role" ADD VALUE 'observer';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "progress" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "progress_mode" "task_progress_mode" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_progress_step" CHECK ("tasks"."progress" between 0 and 100 and "tasks"."progress" % 5 = 0);--> statement-breakpoint
-- Parents start in «auto»: the weighted average of their subtasks as people see them (finished
-- = 100, canceled left out), rounded to a step of 5 — the same rule as weightedProgress.
UPDATE tasks p
SET progress = LEAST(100, GREATEST(0, ROUND(c.avg / 5) * 5))
FROM (
  SELECT
    tenant_id,
    parent_id,
    SUM(CASE WHEN status_category = 'done' THEN 100 ELSE progress END * weight)::numeric
      / NULLIF(SUM(weight), 0) AS avg
  FROM tasks
  WHERE parent_id IS NOT NULL AND deleted_at IS NULL AND status_category <> 'canceled'
  GROUP BY tenant_id, parent_id
) c
WHERE p.tenant_id = c.tenant_id AND p.id = c.parent_id AND c.avg IS NOT NULL;
