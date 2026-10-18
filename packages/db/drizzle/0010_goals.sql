CREATE TYPE "public"."checkin_status" AS ENUM('on_track', 'at_risk', 'off_track');--> statement-breakpoint
CREATE TYPE "public"."goal_level" AS ENUM('company', 'department', 'individual');--> statement-breakpoint
CREATE TYPE "public"."key_result_kind" AS ENUM('number', 'percent', 'boolean');--> statement-breakpoint
CREATE TABLE "goal_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"year" smallint NOT NULL,
	"quarter" smallint NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_periods_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "goal_periods_tenant_quarter_key" UNIQUE("tenant_id","year","quarter")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"period_id" uuid NOT NULL,
	"level" "goal_level" NOT NULL,
	"department_id" uuid,
	"owner_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"progress" double precision DEFAULT 0 NOT NULL,
	"status" "checkin_status",
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "goals_department_by_level" CHECK (("goals"."level" = 'company') = ("goals"."department_id" is null))
);
--> statement-breakpoint
CREATE TABLE "key_result_checkins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"key_result_id" uuid NOT NULL,
	"value" double precision NOT NULL,
	"status" "checkin_status" NOT NULL,
	"note" text,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "key_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "key_result_kind" NOT NULL,
	"start_value" double precision DEFAULT 0 NOT NULL,
	"target_value" double precision NOT NULL,
	"current_value" double precision DEFAULT 0 NOT NULL,
	"unit" text,
	"weight" smallint DEFAULT 1 NOT NULL,
	"sort_key" text DEFAULT 'a0' NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"status" "checkin_status",
	"last_checkin_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "key_results_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "key_results_weight_range" CHECK ("key_results"."weight" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "key_result_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "key_result_id" uuid;--> statement-breakpoint
ALTER TABLE "goal_periods" ADD CONSTRAINT "goal_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_period_fk" FOREIGN KEY ("tenant_id","period_id") REFERENCES "public"."goal_periods"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_fk" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."goals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_result_checkins" ADD CONSTRAINT "key_result_checkins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_result_checkins" ADD CONSTRAINT "key_result_checkins_kr_fk" FOREIGN KEY ("tenant_id","key_result_id") REFERENCES "public"."key_results"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_result_checkins" ADD CONSTRAINT "key_result_checkins_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_goal_fk" FOREIGN KEY ("tenant_id","goal_id") REFERENCES "public"."goals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_tenant_period_level_idx" ON "goals" USING btree ("tenant_id","period_id","level");--> statement-breakpoint
CREATE INDEX "goals_tenant_parent_idx" ON "goals" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "goals_tenant_owner_idx" ON "goals" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX "key_result_checkins_kr_created_idx" ON "key_result_checkins" USING btree ("tenant_id","key_result_id","created_at");--> statement-breakpoint
CREATE INDEX "key_results_tenant_goal_idx" ON "key_results" USING btree ("tenant_id","goal_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_key_result_fk" FOREIGN KEY ("tenant_id","key_result_id") REFERENCES "public"."key_results"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_key_result_fk" FOREIGN KEY ("tenant_id","key_result_id") REFERENCES "public"."key_results"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_tenant_key_result_idx" ON "projects" USING btree ("tenant_id","key_result_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_key_result_idx" ON "tasks" USING btree ("tenant_id","key_result_id");--> statement-breakpoint

-- Goals (phase 1, step 7): grants and forced tenant isolation (ADR 0002, ADR 0013).
-- Goals and key results are archived, never deleted by the application.
GRANT SELECT, INSERT, UPDATE ON goal_periods, goals, key_results TO madar_app;
--> statement-breakpoint
-- Check-ins are history: append-only.
GRANT SELECT, INSERT ON key_result_checkins TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('goal_periods');
--> statement-breakpoint
SELECT app.enable_tenant_rls('goals');
--> statement-breakpoint
SELECT app.enable_tenant_rls('key_results');
--> statement-breakpoint
SELECT app.enable_tenant_rls('key_result_checkins');
--> statement-breakpoint
-- New permission goal.manage (company goals) for the owner and executive roles of existing companies.
INSERT INTO role_grants (tenant_id, role_id, permission, scope)
SELECT r.tenant_id, r.id, 'goal.manage', 'tenant'
FROM roles r
WHERE r.key IN ('owner', 'executive') AND r.is_system
ON CONFLICT DO NOTHING;
