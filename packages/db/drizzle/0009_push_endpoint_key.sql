-- One row per browser and company: keep only the newest subscription of a shared endpoint.
DELETE FROM push_subscriptions a USING push_subscriptions b
WHERE a.tenant_id = b.tenant_id AND a.endpoint = b.endpoint AND a.created_at < b.created_at;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP CONSTRAINT "push_subscriptions_member_endpoint_key";--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE("tenant_id","endpoint");