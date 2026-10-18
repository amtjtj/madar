CREATE TYPE "public"."report_scope" AS ENUM('company', 'department');--> statement-breakpoint
CREATE TABLE "weekly_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"scope" "report_scope" NOT NULL,
	"department_id" uuid,
	"week_start" date NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reports_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "weekly_reports_week_key" UNIQUE NULLS NOT DISTINCT("tenant_id","scope","department_id","week_start"),
	CONSTRAINT "weekly_reports_department_by_scope" CHECK (("weekly_reports"."scope" = 'company') = ("weekly_reports"."department_id" is null))
);
--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Weekly reports (phase 1, step 8b): written by the worker (madar_worker inherits madar_app),
-- read by the API; snapshots are never changed or deleted by the application.
GRANT SELECT, INSERT ON weekly_reports TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('weekly_reports');
