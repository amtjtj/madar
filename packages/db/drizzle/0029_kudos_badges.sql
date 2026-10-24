CREATE TYPE "public"."value_tag" AS ENUM('teamwork', 'help', 'quality', 'speed', 'learning', 'initiative');--> statement-breakpoint
ALTER TYPE "public"."xp_reason" ADD VALUE 'kudos_received';--> statement-breakpoint
ALTER TYPE "public"."xp_reason" ADD VALUE 'helped';--> statement-breakpoint
CREATE TABLE "kudos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"value_tag" "value_tag" NOT NULL,
	"message" text NOT NULL,
	"task_id" uuid,
	"private" boolean DEFAULT false NOT NULL,
	"hidden_at" timestamp with time zone,
	"week_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kudos_not_self" CHECK ("kudos"."from_member_id" <> "kudos"."to_member_id")
);
--> statement-breakpoint
CREATE TABLE "member_badges" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"badge_key" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_badges_tenant_id_member_id_badge_key_pk" PRIMARY KEY("tenant_id","member_id","badge_key")
);
--> statement-breakpoint
CREATE TABLE "member_counters" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"counter_key" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "member_counters_tenant_id_member_id_counter_key_pk" PRIMARY KEY("tenant_id","member_id","counter_key")
);
--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_from_fk" FOREIGN KEY ("tenant_id","from_member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_to_fk" FOREIGN KEY ("tenant_id","to_member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_badges" ADD CONSTRAINT "member_badges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_badges" ADD CONSTRAINT "member_badges_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_counters" ADD CONSTRAINT "member_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_counters" ADD CONSTRAINT "member_counters_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kudos_to_idx" ON "kudos" USING btree ("tenant_id","to_member_id","id");--> statement-breakpoint
CREATE INDEX "kudos_from_week_idx" ON "kudos" USING btree ("tenant_id","from_member_id","week_start");--> statement-breakpoint
-- Kudos and badges (phase 3, step 18b). Kudos are never edited or deleted; the receiver may hide
-- one from their profile. Badges are kept for good. Counters belong to the worker.
GRANT SELECT, INSERT ON kudos TO madar_app;
--> statement-breakpoint
GRANT UPDATE (hidden_at) ON kudos TO madar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON member_counters TO madar_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON member_badges TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('kudos');
--> statement-breakpoint
SELECT app.enable_tenant_rls('member_counters');
--> statement-breakpoint
SELECT app.enable_tenant_rls('member_badges');
--> statement-breakpoint
-- Only the receiver changes a kudos, and only by hiding it (the rest is checked by the API too).
CREATE POLICY receiver_hides_only ON kudos AS RESTRICTIVE FOR UPDATE TO madar_app
  USING (to_member_id = app.current_member_id())
  WITH CHECK (to_member_id = app.current_member_id() AND hidden_at IS NOT NULL);
