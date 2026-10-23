-- pgvector for the knowledge index (phase 3, step 16b, ADR 0026). Created by the database owner
-- (the superuser of the Postgres container); the image is docker/postgres.Dockerfile.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."knowledge_source" AS ENUM('task', 'letter', 'meeting', 'channel');--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT app.current_tenant_id() NOT NULL,
	"source_type" "knowledge_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"day" date,
	"chunk_no" integer NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunks_source_key" UNIQUE NULLS NOT DISTINCT("tenant_id","source_type","source_id","day","chunk_no")
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_tenant_idx" ON "knowledge_chunks" USING btree ("tenant_id","model");--> statement-breakpoint

-- The knowledge index: written and replaced by the worker (madar_worker inherits madar_app), read by
-- the API, and cleared by the API when a company turns the assistant off.
GRANT SELECT, INSERT, UPDATE, DELETE ON knowledge_chunks TO madar_app;
--> statement-breakpoint
SELECT app.enable_tenant_rls('knowledge_chunks');
