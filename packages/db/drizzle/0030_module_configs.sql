CREATE TABLE "module_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"department_id" uuid NOT NULL,
	"template_key" text,
	"template_version" integer,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_configs_department_version_key" UNIQUE("tenant_id","department_id","version"),
	CONSTRAINT "module_configs_version_positive" CHECK ("module_configs"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "module_configs" ADD CONSTRAINT "module_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_configs" ADD CONSTRAINT "module_configs_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_configs" ADD CONSTRAINT "module_configs_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Department module configs (phase 3, step 19a, ADR 0004): every save is a new version; old
-- versions are never changed or removed.
GRANT SELECT, INSERT ON module_configs TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('module_configs');
