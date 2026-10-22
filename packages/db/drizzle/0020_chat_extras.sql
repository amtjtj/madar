ALTER TYPE "public"."attachment_subject" ADD VALUE 'message';--> statement-breakpoint
CREATE TABLE "message_mentions" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"message_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_mentions_tenant_id_message_id_member_id_pk" PRIMARY KEY("tenant_id","message_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"message_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_tenant_id_message_id_member_id_emoji_pk" PRIMARY KEY("tenant_id","message_id","member_id","emoji"),
	CONSTRAINT "message_reactions_emoji_check" CHECK ("message_reactions"."emoji" in ('👍', '❤️', '😂', '🎉', '🙏', '👀'))
);
--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_mentions_member_idx" ON "message_mentions" USING btree ("tenant_id","member_id","message_id");--> statement-breakpoint
-- Derived rows, not records: a reaction is taken back and an edit drops a mention (ADR 0022).
GRANT SELECT, INSERT, UPDATE, DELETE ON message_mentions, message_reactions TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('message_mentions');
--> statement-breakpoint
SELECT app.enable_tenant_rls('message_reactions');
