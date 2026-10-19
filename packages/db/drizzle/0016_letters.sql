CREATE TYPE "public"."letter_recipient_kind" AS ENUM('to', 'cc', 'referral');--> statement-breakpoint
CREATE TYPE "public"."letter_urgency" AS ENUM('normal', 'urgent', 'immediate');--> statement-breakpoint
ALTER TYPE "public"."attachment_subject" ADD VALUE 'letter';--> statement-breakpoint
CREATE TABLE "letter_counters" (
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"jalali_year" smallint NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "letter_counters_tenant_id_jalali_year_pk" PRIMARY KEY("tenant_id","jalali_year")
);
--> statement-breakpoint
CREATE TABLE "letter_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"letter_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "letter_recipient_kind" NOT NULL,
	"referred_by" uuid,
	"referral_note" text,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letter_recipients_letter_member_key" UNIQUE("tenant_id","letter_id","member_id"),
	CONSTRAINT "letter_recipients_referral" CHECK (("letter_recipients"."kind" = 'referral') = ("letter_recipients"."referred_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "letters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"number" text,
	"jalali_year" smallint,
	"sequence" integer,
	"subject" text NOT NULL,
	"body" jsonb NOT NULL,
	"sender_id" uuid NOT NULL,
	"urgency" "letter_urgency" DEFAULT 'normal' NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"thread_id" uuid NOT NULL,
	"reply_to_id" uuid,
	"sent_at" timestamp with time zone,
	"sender_archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "letters_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "letters_tenant_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "letters_tenant_year_sequence_key" UNIQUE("tenant_id","jalali_year","sequence"),
	CONSTRAINT "letters_number_when_sent" CHECK (("letters"."sent_at" is null) = ("letters"."number" is null) and ("letters"."number" is null) = ("letters"."sequence" is null) and ("letters"."number" is null) = ("letters"."jalali_year" is null)),
	CONSTRAINT "letters_draft_deleted_only" CHECK ("letters"."deleted_at" is null or "letters"."sent_at" is null)
);
--> statement-breakpoint
ALTER TABLE "letter_counters" ADD CONSTRAINT "letter_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_recipients" ADD CONSTRAINT "letter_recipients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_recipients" ADD CONSTRAINT "letter_recipients_letter_fk" FOREIGN KEY ("tenant_id","letter_id") REFERENCES "public"."letters"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_recipients" ADD CONSTRAINT "letter_recipients_member_fk" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_recipients" ADD CONSTRAINT "letter_recipients_referred_by_fk" FOREIGN KEY ("tenant_id","referred_by") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_sender_fk" FOREIGN KEY ("tenant_id","sender_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_thread_fk" FOREIGN KEY ("tenant_id","thread_id") REFERENCES "public"."letters"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters" ADD CONSTRAINT "letters_reply_to_fk" FOREIGN KEY ("tenant_id","reply_to_id") REFERENCES "public"."letters"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "letter_recipients_inbox_idx" ON "letter_recipients" USING btree ("tenant_id","member_id","archived_at","created_at");--> statement-breakpoint
CREATE INDEX "letters_tenant_sender_idx" ON "letters" USING btree ("tenant_id","sender_id","sent_at");--> statement-breakpoint
CREATE INDEX "letters_tenant_thread_idx" ON "letters" USING btree ("tenant_id","thread_id");--> statement-breakpoint
-- No DELETE: a sent letter is permanent and a draft is soft-deleted (ADR 0020).
GRANT SELECT, INSERT, UPDATE ON letters, letter_recipients, letter_counters TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('letters');
--> statement-breakpoint
SELECT app.enable_tenant_rls('letter_recipients');
--> statement-breakpoint
SELECT app.enable_tenant_rls('letter_counters');
