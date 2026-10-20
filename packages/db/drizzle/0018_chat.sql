CREATE TYPE "public"."conversation_kind" AS ENUM('project', 'department', 'direct', 'group');--> statement-breakpoint
CREATE TYPE "public"."conversation_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "conversation_role" DEFAULT 'member' NOT NULL,
	"last_read_message_id" uuid,
	"muted" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "conversation_members_tenant_id_conversation_id_member_id_pk" PRIMARY KEY("tenant_id","conversation_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"kind" "conversation_kind" NOT NULL,
	"project_id" uuid,
	"department_id" uuid,
	"title" text,
	"direct_key" text,
	"created_by" uuid,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "conversations_tenant_project_key" UNIQUE("tenant_id","project_id"),
	CONSTRAINT "conversations_tenant_department_key" UNIQUE("tenant_id","department_id"),
	CONSTRAINT "conversations_tenant_direct_key" UNIQUE("tenant_id","direct_key"),
	CONSTRAINT "conversations_kind_columns" CHECK (("conversations"."kind" = 'project') = ("conversations"."project_id" is not null)
        and ("conversations"."kind" = 'department') = ("conversations"."department_id" is not null)
        and ("conversations"."kind" = 'direct') = ("conversations"."direct_key" is not null)
        and ("conversations"."kind" <> 'group' or "conversations"."title" is not null))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"reply_to_id" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_fk" FOREIGN KEY ("tenant_id","reply_to_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_members_member_idx" ON "conversation_members" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("tenant_id","conversation_id","id");--> statement-breakpoint
-- No DELETE anywhere: messages are soft-deleted, people leave with left_at (ADR 0022).
GRANT SELECT, INSERT, UPDATE ON conversations, conversation_members, messages TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('conversations');
--> statement-breakpoint
SELECT app.enable_tenant_rls('conversation_members');
--> statement-breakpoint
SELECT app.enable_tenant_rls('messages');
--> statement-breakpoint
-- Channels for the projects and active departments that already exist (run as the owner, so
-- every tenant at once). Conversation ids need no time order, so a random UUID is fine here.
INSERT INTO conversations (id, tenant_id, kind, project_id, created_at)
  SELECT gen_random_uuid(), p.tenant_id, 'project', p.id, now() FROM projects p
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO conversations (id, tenant_id, kind, department_id, created_at)
  SELECT gen_random_uuid(), d.tenant_id, 'department', d.id, now() FROM departments d
  WHERE d.archived_at IS NULL
  ON CONFLICT DO NOTHING;
