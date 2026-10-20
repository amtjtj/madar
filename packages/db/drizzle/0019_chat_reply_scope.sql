-- A reply points into its own conversation (ADR 0022): the FK now includes conversation_id.
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_conversation_id_key" UNIQUE("tenant_id","conversation_id","id");--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_reply_to_fk";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_fk" FOREIGN KEY ("tenant_id","conversation_id","reply_to_id") REFERENCES "public"."messages"("tenant_id","conversation_id","id") ON DELETE restrict ON UPDATE no action;
