CREATE TYPE "public"."meeting_response" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
ALTER TYPE "public"."evidence_kind" ADD VALUE 'minutes';--> statement-breakpoint
CREATE TABLE "meeting_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"type" "meeting_type" NOT NULL,
	"title" text NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"starts_on" date NOT NULL,
	"until_on" date,
	"location" text,
	"link" text,
	"agenda" text DEFAULT '' NOT NULL,
	"organizer_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"generated_until" date NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_series_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "meeting_series_weekday" CHECK ("meeting_series"."weekday" between 0 and 6),
	CONSTRAINT "meeting_series_times" CHECK ("meeting_series"."end_time" > "meeting_series"."start_time"),
	CONSTRAINT "meeting_series_until" CHECK ("meeting_series"."until_on" is null or "meeting_series"."until_on" >= "meeting_series"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "meeting_series_participants" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"series_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_series_participants_tenant_id_series_id_member_id_pk" PRIMARY KEY("tenant_id","series_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD COLUMN "response" "meeting_response" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD COLUMN "responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "occurs_on" date;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "detached" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_series" ADD CONSTRAINT "meeting_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series" ADD CONSTRAINT "meeting_series_organizer_fk" FOREIGN KEY ("tenant_id","organizer_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series" ADD CONSTRAINT "meeting_series_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series_participants" ADD CONSTRAINT "meeting_series_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series_participants" ADD CONSTRAINT "meeting_series_participants_series_fk" FOREIGN KEY ("tenant_id","series_id") REFERENCES "public"."meeting_series"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series_participants" ADD CONSTRAINT "meeting_series_participants_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_series_fk" FOREIGN KEY ("tenant_id","series_id") REFERENCES "public"."meeting_series"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_series_day_key" UNIQUE("tenant_id","series_id","occurs_on");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_series_day" CHECK (("meetings"."series_id" is null) = ("meetings"."occurs_on" is null));--> statement-breakpoint
-- A series is never deleted (canceling is soft); its people change (plan phase-2-step-13b).
GRANT SELECT, INSERT, UPDATE ON meeting_series TO madar_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_series_participants TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('meeting_series');
--> statement-breakpoint
SELECT app.enable_tenant_rls('meeting_series_participants');
--> statement-breakpoint
-- The organizer of an existing meeting is coming to it.
UPDATE meeting_participants mp SET response = 'accepted'
FROM meetings m
WHERE m.tenant_id = mp.tenant_id AND m.id = mp.meeting_id AND m.organizer_id = mp.member_id;
