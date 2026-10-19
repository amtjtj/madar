CREATE TYPE "public"."attachment_status" AS ENUM('pending', 'ready');--> statement-breakpoint
CREATE TYPE "public"."attachment_subject" AS ENUM('task', 'comment');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"subject_type" "attachment_subject",
	"subject_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"extension" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"checksum" text NOT NULL,
	"object_key" text NOT NULL,
	"status" "attachment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "attachments_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "attachments_object_key_key" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fk" FOREIGN KEY ("tenant_id","uploaded_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_tenant_subject_idx" ON "attachments" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "attachments_tenant_status_idx" ON "attachments" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
-- No DELETE: attachments are soft-deleted and purged from storage by the worker (ADR 0019).
GRANT SELECT, INSERT, UPDATE ON attachments TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('attachments');
