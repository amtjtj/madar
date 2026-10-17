CREATE TYPE "public"."collaborator_kind" AS ENUM('collaborator', 'watcher');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('department', 'tenant', 'private');--> statement-breakpoint
CREATE TYPE "public"."status_category" AS ENUM('todo', 'in_progress', 'done', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"actor_id" uuid,
	"verb" text NOT NULL,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_plan_items" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"task_id" uuid NOT NULL,
	"sort_key" text DEFAULT 'a0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_plan_items_tenant_id_member_id_plan_date_task_id_pk" PRIMARY KEY("tenant_id","member_id","plan_date","task_id")
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"type" text NOT NULL,
	"version" smallint DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"project_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "project_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_tenant_id_project_id_member_id_pk" PRIMARY KEY("tenant_id","project_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"visibility" "project_visibility" DEFAULT 'department' NOT NULL,
	"owner_id" uuid NOT NULL,
	"color" text,
	"start_on" date,
	"due_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "task_collaborators" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "collaborator_kind" DEFAULT 'collaborator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_collaborators_tenant_id_task_id_member_id_pk" PRIMARY KEY("tenant_id","task_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"department_id" uuid NOT NULL,
	"project_id" uuid,
	"parent_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"type_key" text DEFAULT 'task' NOT NULL,
	"status_key" text DEFAULT 'todo' NOT NULL,
	"status_category" "status_category" DEFAULT 'todo' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"assignee_id" uuid,
	"reporter_id" uuid NOT NULL,
	"due_on" date,
	"completed_at" timestamp with time zone,
	"weight" smallint DEFAULT 1 NOT NULL,
	"sort_key" text DEFAULT 'a0' NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_plan_items" ADD CONSTRAINT "daily_plan_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_plan_items" ADD CONSTRAINT "daily_plan_items_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_plan_items" ADD CONSTRAINT "daily_plan_items_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_fk" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_collaborators" ADD CONSTRAINT "task_collaborators_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_fk" FOREIGN KEY ("tenant_id","assignee_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reporter_fk" FOREIGN KEY ("tenant_id","reporter_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_tenant_subject_idx" ON "activities" USING btree ("tenant_id","subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_tenant_subject_idx" ON "comments" USING btree ("tenant_id","subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "daily_plan_items_task_idx" ON "daily_plan_items" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "domain_events_unpublished_idx" ON "domain_events" USING btree ("tenant_id","occurred_at") WHERE "domain_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "project_members_member_idx" ON "project_members" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "projects_tenant_department_idx" ON "projects" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE INDEX "task_collaborators_member_idx" ON "task_collaborators" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_department_status_idx" ON "tasks" USING btree ("tenant_id","department_id","status_category");--> statement-breakpoint
CREATE INDEX "tasks_tenant_assignee_status_idx" ON "tasks" USING btree ("tenant_id","assignee_id","status_category");--> statement-breakpoint
CREATE INDEX "tasks_tenant_project_idx" ON "tasks" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_parent_idx" ON "tasks" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_due_idx" ON "tasks" USING btree ("tenant_id","due_on");