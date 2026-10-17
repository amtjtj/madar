CREATE TABLE "notification_preferences" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"muted_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"off_hours" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_tenant_id_member_id_pk" PRIMARY KEY("tenant_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"actor_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deliver_after" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "notifications_recipient_dedupe_key" UNIQUE("tenant_id","recipient_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_tenant_id_consumer_event_id_pk" PRIMARY KEY("tenant_id","consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "work_calendars" (
	"tenant_id" uuid PRIMARY KEY DEFAULT app.current_tenant_id() NOT NULL,
	"weekly_hours" jsonb NOT NULL,
	"holidays" date[] DEFAULT '{}'::date[] NOT NULL,
	"overdue_escalation_days" smallint DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_fk" FOREIGN KEY ("tenant_id","recipient_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_events" ADD CONSTRAINT "processed_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_calendars" ADD CONSTRAINT "work_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("tenant_id","recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("tenant_id","recipient_id") WHERE "notifications"."read_at" is null;