CREATE TYPE "public"."meeting_type" AS ENUM('regular', 'okr_review', 'one_on_one');--> statement-breakpoint
ALTER TYPE "public"."attachment_subject" ADD VALUE 'minutes';--> statement-breakpoint
CREATE TABLE "meeting_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"text" text NOT NULL,
	"task_id" uuid,
	"key_result_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_decisions_task_key" UNIQUE("tenant_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_minutes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meeting_minutes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "meeting_minutes_meeting_key" UNIQUE("tenant_id","meeting_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_participants" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_participants_tenant_id_meeting_id_member_id_pk" PRIMARY KEY("tenant_id","meeting_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"type" "meeting_type" NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text,
	"link" text,
	"agenda" text DEFAULT '' NOT NULL,
	"organizer_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "meetings_ends_after_start" CHECK ("meetings"."ends_at" > "meetings"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."meetings"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_key_result_fk" FOREIGN KEY ("tenant_id","key_result_id") REFERENCES "public"."key_results"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."meetings"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."meetings"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_fk" FOREIGN KEY ("tenant_id","organizer_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_decisions_meeting_idx" ON "meeting_decisions" USING btree ("tenant_id","meeting_id");--> statement-breakpoint
CREATE INDEX "meeting_participants_member_idx" ON "meeting_participants" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "meetings_tenant_starts_idx" ON "meetings" USING btree ("tenant_id","starts_at");--> statement-breakpoint
-- Meetings and minutes are records: never deleted (a meeting is canceled softly; ADR 0023).
-- Participants are removed before a meeting starts and a decision is deleted while it has no task.
GRANT SELECT, INSERT, UPDATE ON meetings, meeting_minutes TO madar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_participants, meeting_decisions TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('meetings');
--> statement-breakpoint
SELECT app.enable_tenant_rls('meeting_participants');
--> statement-breakpoint
SELECT app.enable_tenant_rls('meeting_minutes');
--> statement-breakpoint
SELECT app.enable_tenant_rls('meeting_decisions');
--> statement-breakpoint
CREATE POLICY decisions_without_task_only ON meeting_decisions AS RESTRICTIVE FOR DELETE TO madar_app
  USING (task_id IS NULL);
