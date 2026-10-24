CREATE TYPE "public"."streak_status" AS ENUM('completed', 'missed', 'excused_leave', 'excused_holiday', 'off_day');--> statement-breakpoint
CREATE TYPE "public"."xp_reason" AS ENUM('task_completed', 'on_time', 'goal_checkin', 'reversal');--> statement-breakpoint
CREATE TABLE "member_stats" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"xp_total" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"streak_through" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_stats_tenant_id_member_id_pk" PRIMARY KEY("tenant_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "streak_days" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"day" date NOT NULL,
	"status" "streak_status" NOT NULL,
	"planned" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "streak_days_tenant_id_member_id_day_pk" PRIMARY KEY("tenant_id","member_id","day")
);
--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reason" "xp_reason" NOT NULL,
	"source_key" text NOT NULL,
	"task_id" uuid,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_ledger_source_key" UNIQUE("tenant_id","reason","source_key"),
	CONSTRAINT "xp_ledger_sign" CHECK (("xp_ledger"."reason" = 'reversal') = ("xp_ledger"."amount" < 0))
);
--> statement-breakpoint
ALTER TABLE "member_stats" ADD CONSTRAINT "member_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_stats" ADD CONSTRAINT "member_stats_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streak_days" ADD CONSTRAINT "streak_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streak_days" ADD CONSTRAINT "streak_days_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xp_ledger_member_idx" ON "xp_ledger" USING btree ("tenant_id","member_id","day");--> statement-breakpoint
CREATE INDEX "xp_ledger_task_idx" ON "xp_ledger" USING btree ("tenant_id","task_id");--> statement-breakpoint
-- Gamification (phase 3, step 18a, ADR 0029). XP is a ledger: inserted, never changed or deleted.
-- A closed day changes only from missed to excused leave (a leave approved afterwards).
GRANT SELECT, INSERT ON xp_ledger TO madar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON streak_days, member_stats TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('xp_ledger');
--> statement-breakpoint
SELECT app.enable_tenant_rls('streak_days');
--> statement-breakpoint
SELECT app.enable_tenant_rls('member_stats');
--> statement-breakpoint
CREATE POLICY missed_to_leave_only ON streak_days AS RESTRICTIVE FOR UPDATE TO madar_app
  USING (status = 'missed') WITH CHECK (status = 'excused_leave');
