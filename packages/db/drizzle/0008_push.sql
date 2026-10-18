CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_member_endpoint_key" UNIQUE("tenant_id","member_id","endpoint")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Web Push (phase 1, step 6b): members manage their own device subscriptions; forced isolation.
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('push_subscriptions');
--> statement-breakpoint
-- Notifications created before device push existed are never pushed.
UPDATE notifications SET pushed_at = created_at WHERE pushed_at IS NULL;
--> statement-breakpoint
-- The delivery job looks up a member's unread, not yet pushed notifications.
CREATE INDEX IF NOT EXISTS notifications_recipient_unpushed_idx ON notifications (tenant_id, recipient_id, deliver_after) WHERE pushed_at IS NULL AND read_at IS NULL;
