-- Migration: 0000_init.sql
-- Generated SQL for creating tenants and users tables.
-- You can run this directly in your Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"subdomain" varchar(100) NOT NULL,
	"custom_domain" varchar(255),
	"primary_color" varchar(7) DEFAULT '#0f172a' NOT NULL,
	"secondary_color" varchar(7) DEFAULT '#475569' NOT NULL,
	"accent_color" varchar(7) DEFAULT '#10b981' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_subdomain_unique" UNIQUE("subdomain"),
	CONSTRAINT "tenants_custom_domain_unique" UNIQUE("custom_domain")
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Foreign Key Constraints
DO $$ BEGIN
 ALTER TABLE "users" 
 ADD CONSTRAINT "users_tenant_id_tenants_id_fk" 
 FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") 
 ON DELETE CASCADE 
 ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
