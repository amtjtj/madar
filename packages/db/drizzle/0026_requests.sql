CREATE TYPE "public"."leave_kind" AS ENUM('daily', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."request_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."request_kind" AS ENUM('leave', 'expense', 'general');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'canceled');--> statement-breakpoint
ALTER TYPE "public"."attachment_subject" ADD VALUE 'approval_request';--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"kind" "request_kind" NOT NULL,
	"requester_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"title" text NOT NULL,
	"data" jsonb NOT NULL,
	"amount_rial" bigint,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "approval_requests_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "approval_requests_amount_by_kind" CHECK (("approval_requests"."kind" = 'expense') = ("approval_requests"."amount_rial" is not null)),
	CONSTRAINT "approval_requests_decided" CHECK (("approval_requests"."status" = 'pending') = ("approval_requests"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"approver_id" uuid NOT NULL,
	"decided_by" uuid NOT NULL,
	"decision" "request_decision" NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_steps_request_step_key" UNIQUE("tenant_id","request_id","step_index")
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"member_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" "leave_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaves_request_key" UNIQUE("tenant_id","request_id"),
	CONSTRAINT "leaves_dates" CHECK ("leaves"."ends_on" >= "leaves"."starts_on"),
	CONSTRAINT "leaves_times_by_kind" CHECK (("leaves"."kind" = 'hourly') = ("leaves"."starts_at" is not null and "leaves"."ends_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_fk" FOREIGN KEY ("tenant_id","requester_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."approval_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_fk" FOREIGN KEY ("tenant_id","approver_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."approval_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_requester_idx" ON "approval_requests" USING btree ("tenant_id","requester_id");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "leaves_member_dates_idx" ON "leaves" USING btree ("tenant_id","member_id","starts_on");--> statement-breakpoint
-- Requests and approvals (phase 3, step 17b, ADR 0028). A request moves forward by decision or
-- cancel only; decisions and leaves are records: inserted, never changed or deleted.
GRANT SELECT, INSERT, UPDATE ON approval_requests TO madar_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON approval_steps, leaves TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('approval_requests');
--> statement-breakpoint
SELECT app.enable_tenant_rls('approval_steps');
--> statement-breakpoint
SELECT app.enable_tenant_rls('leaves');
--> statement-breakpoint
-- Only an open request changes (a decided or canceled one stays as it was).
CREATE POLICY open_requests_only ON approval_requests AS RESTRICTIVE FOR UPDATE TO madar_app
  USING (status = 'pending') WITH CHECK (true);
