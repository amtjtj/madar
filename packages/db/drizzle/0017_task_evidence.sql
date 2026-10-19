CREATE TYPE "public"."evidence_kind" AS ENUM('letter');--> statement-breakpoint
CREATE TABLE "task_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"pinned_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unpinned_at" timestamp with time zone,
	"unpinned_by" uuid
);
--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_pinned_by_fk" FOREIGN KEY ("tenant_id","pinned_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_unpinned_by_fk" FOREIGN KEY ("tenant_id","unpinned_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_evidence_active_key" ON "task_evidence" USING btree ("tenant_id","task_id","kind","subject_id") WHERE "task_evidence"."unpinned_at" is null;--> statement-breakpoint
CREATE INDEX "task_evidence_subject_idx" ON "task_evidence" USING btree ("tenant_id","kind","subject_id");--> statement-breakpoint
-- No DELETE: unpinning is soft (ADR 0021).
GRANT SELECT, INSERT, UPDATE ON task_evidence TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('task_evidence');
