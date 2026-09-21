-- Optional provenance only. PostgreSQL 15+ column-specific SET NULL preserves
-- the appointment's canonical tenant and customer when a sale is deleted.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS sales_opportunity_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS sales_opportunities_identity_unique
  ON sales_opportunities(id, tenant_id, client_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appointments_sales_customer_fk' AND conrelid='appointments'::regclass) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_sales_customer_fk
      FOREIGN KEY (sales_opportunity_id, tenant_id, client_id)
      REFERENCES sales_opportunities(id, tenant_id, client_id)
      ON DELETE SET NULL (sales_opportunity_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appointments_sales_customer_required' AND conrelid='appointments'::regclass) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_sales_customer_required
      CHECK (sales_opportunity_id IS NULL OR client_id IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS appointments_tenant_sale_date_idx
  ON appointments(tenant_id, sales_opportunity_id, start_time, id)
  WHERE sales_opportunity_id IS NOT NULL;
