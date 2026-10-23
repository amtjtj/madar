CREATE TABLE "report_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"report_id" uuid NOT NULL,
	"text" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_summaries_report_key" UNIQUE("tenant_id","report_id")
);
--> statement-breakpoint
ALTER TABLE "report_summaries" ADD CONSTRAINT "report_summaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_summaries" ADD CONSTRAINT "report_summaries_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."weekly_reports"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Assistant summaries of weekly reports (phase 3, step 16a): written once by the worker
-- (madar_worker inherits madar_app), read by the API; never changed or deleted by the application.
GRANT SELECT, INSERT ON report_summaries TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('report_summaries');
