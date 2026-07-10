ALTER TABLE "appointments" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "resource_id" uuid;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "discount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
