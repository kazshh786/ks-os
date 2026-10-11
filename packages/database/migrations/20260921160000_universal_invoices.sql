-- Operational receivables, not a general ledger. No historical money backfill.
ALTER TABLE checkout_transactions ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE RESTRICT;
ALTER TABLE checkout_transactions ADD COLUMN IF NOT EXISTS currency varchar(3);
CREATE UNIQUE INDEX IF NOT EXISTS clients_invoice_identity ON clients(id,tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS quotes_invoice_identity ON sales_quotes(id,tenant_id,client_id);
CREATE UNIQUE INDEX IF NOT EXISTS work_invoice_identity ON work_items(id,tenant_id,client_id);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_invoice_identity ON appointments(id,tenant_id,client_id);
CREATE UNIQUE INDEX IF NOT EXISTS checkout_invoice_identity ON checkout_transactions(id,tenant_id,client_id,currency);
CREATE INDEX IF NOT EXISTS checkout_invoice_customer ON checkout_transactions(tenant_id,client_id,created_at);
CREATE INDEX IF NOT EXISTS checkout_invoice_provider_evidence ON checkout_transactions(tenant_id,stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refunds_invoice_payment ON stripe_refunds(tenant_id,checkout_transaction_id,status);

CREATE TABLE IF NOT EXISTS invoice_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  terms_days integer NOT NULL DEFAULT 30 CHECK(terms_days IN (0,7,14,30)),
  prefix varchar(10) NOT NULL DEFAULT 'INV' CHECK(prefix ~ '^[A-Z][A-Z0-9-]{0,9}$'),
  footer text NOT NULL DEFAULT '', next_number bigint NOT NULL DEFAULT 1 CHECK(next_number>0)
);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, client_id uuid NOT NULL,
  invoice_number varchar(50) NOT NULL, title varchar(255) NOT NULL, status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ISSUED','VOID')),
  currency varchar(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  subtotal_minor integer NOT NULL CHECK(subtotal_minor>=0), tax_minor integer NOT NULL CHECK(tax_minor>=0),
  total_minor integer NOT NULL CHECK(total_minor>0 AND total_minor::bigint=subtotal_minor::bigint+tax_minor),
  due_at timestamptz NOT NULL, issued_at timestamptz, voided_at timestamptz,
  customer_name varchar(255) NOT NULL, memo text NOT NULL DEFAULT '', footer text NOT NULL DEFAULT '',
  source_quote_id uuid, source_opportunity_id uuid, source_work_item_id uuid, source_appointment_id uuid,
  idempotency_key varchar(100) NOT NULL, request_hash varchar(64) NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,invoice_number), UNIQUE(tenant_id,idempotency_key), UNIQUE(id,tenant_id), UNIQUE(id,tenant_id,client_id,currency),
  FOREIGN KEY(client_id,tenant_id) REFERENCES clients(id,tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_quote_id,tenant_id,client_id) REFERENCES sales_quotes(id,tenant_id,client_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_opportunity_id,tenant_id,client_id) REFERENCES sales_opportunities(id,tenant_id,client_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_work_item_id,tenant_id,client_id) REFERENCES work_items(id,tenant_id,client_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_appointment_id,tenant_id,client_id) REFERENCES appointments(id,tenant_id,client_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS invoices_tenant_status_due ON invoices(tenant_id,status,due_at,id);
CREATE INDEX IF NOT EXISTS invoices_tenant_customer_due ON invoices(tenant_id,client_id,due_at,id);
CREATE INDEX IF NOT EXISTS invoices_tenant_work ON invoices(tenant_id,source_work_item_id);
CREATE INDEX IF NOT EXISTS invoices_tenant_sale ON invoices(tenant_id,source_opportunity_id);
CREATE INDEX IF NOT EXISTS invoices_tenant_booking ON invoices(tenant_id,source_appointment_id);
CREATE INDEX IF NOT EXISTS invoices_tenant_quote ON invoices(tenant_id,source_quote_id);
CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,invoice_id uuid NOT NULL,
  description varchar(1000) NOT NULL,quantity integer NOT NULL CHECK(quantity>0),unit_amount_minor integer NOT NULL CHECK(unit_amount_minor>=0),
  tax_rate_basis_points integer NOT NULL CHECK(tax_rate_basis_points BETWEEN 0 AND 10000),
  subtotal_minor integer NOT NULL CHECK(subtotal_minor::bigint=quantity::bigint*unit_amount_minor),
  tax_minor integer NOT NULL CHECK(tax_minor::bigint=(subtotal_minor::bigint*tax_rate_basis_points+5000)/10000),
  total_minor integer NOT NULL CHECK(total_minor::bigint=subtotal_minor::bigint+tax_minor),position integer NOT NULL,
  FOREIGN KEY(invoice_id,tenant_id) REFERENCES invoices(id,tenant_id) ON DELETE CASCADE, UNIQUE(invoice_id,position)
);
CREATE INDEX IF NOT EXISTS invoice_items_tenant_invoice ON invoice_items(tenant_id,invoice_id);
CREATE TABLE IF NOT EXISTS invoice_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,invoice_id uuid NOT NULL,client_id uuid NOT NULL,currency varchar(3) NOT NULL,
  payment_id uuid NOT NULL UNIQUE,amount_minor integer NOT NULL CHECK(amount_minor>0),created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(invoice_id,tenant_id,client_id,currency) REFERENCES invoices(id,tenant_id,client_id,currency) ON DELETE RESTRICT,
  FOREIGN KEY(payment_id,tenant_id,client_id,currency) REFERENCES checkout_transactions(id,tenant_id,client_id,currency) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS invoice_allocations_tenant_invoice ON invoice_payment_allocations(tenant_id,invoice_id);
-- Provider-neutral evidence of an actual staff-confirmed refund of an offline payment.
-- Stripe refunds continue to use stripe_refunds; no provider action is simulated here.
CREATE TABLE IF NOT EXISTS checkout_payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,payment_id uuid NOT NULL REFERENCES checkout_transactions(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL CHECK(amount_minor>0),reason varchar(500) NOT NULL, idempotency_key uuid NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS payment_reversals_tenant_payment ON checkout_payment_reversals(tenant_id,payment_id);
CREATE TABLE IF NOT EXISTS invoice_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,invoice_id uuid NOT NULL,
  activity_type varchar(40) NOT NULL,amount_minor integer CHECK(amount_minor>=0),created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(invoice_id,tenant_id) REFERENCES invoices(id,tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS invoice_activity_tenant_invoice_date ON invoice_activity(tenant_id,invoice_id,created_at,id);

CREATE OR REPLACE VIEW invoice_allocation_balances AS
 SELECT a.*, greatest(0,case when p.payment_status='REFUNDED' then 0 else a.amount_minor
   -coalesce((select sum(r.amount) from stripe_refunds r where r.tenant_id=a.tenant_id and r.checkout_transaction_id=a.payment_id and r.status='SUCCEEDED'),0)
   -coalesce((select sum(r.amount_minor) from checkout_payment_reversals r where r.tenant_id=a.tenant_id and r.payment_id=a.payment_id),0) end)::integer as net_minor
 FROM invoice_payment_allocations a JOIN checkout_transactions p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id;
CREATE OR REPLACE VIEW invoice_balances AS
 SELECT i.*,coalesce(p.paid,0)::integer as paid_minor,
   case when i.status IN ('DRAFT','VOID') then 0 else i.total_minor-coalesce(p.paid,0)::integer end as due_minor
 FROM invoices i LEFT JOIN LATERAL (SELECT sum(net_minor) as paid FROM invoice_allocation_balances a WHERE a.tenant_id=i.tenant_id AND a.invoice_id=i.id) p ON true;

CREATE OR REPLACE FUNCTION guard_invoice_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv invoices%ROWTYPE; pay checkout_transactions%ROWTYPE; paid bigint; net bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Payment allocations are immutable'; END IF;
 SELECT * INTO inv FROM invoices WHERE id=NEW.invoice_id AND tenant_id=NEW.tenant_id FOR UPDATE;
 -- Write the locked invoice version so higher-isolation callers also serialize.
 UPDATE invoices SET updated_at=now() WHERE id=inv.id AND tenant_id=inv.tenant_id;
 SELECT * INTO pay FROM checkout_transactions WHERE id=NEW.payment_id AND tenant_id=NEW.tenant_id FOR UPDATE;
 IF inv.id IS NULL OR pay.id IS NULL OR inv.status<>'ISSUED' OR pay.payment_status<>'SUCCEEDED'
   OR pay.client_id IS DISTINCT FROM inv.client_id OR pay.currency IS DISTINCT FROM inv.currency OR NEW.amount_minor<>pay.total_amount THEN
   RAISE EXCEPTION 'Invoice payment evidence is invalid';
 END IF;
 IF pay.stripe_payment_intent_id IS NOT NULL AND EXISTS(SELECT 1 FROM checkout_transactions duplicate WHERE duplicate.tenant_id=pay.tenant_id AND duplicate.stripe_payment_intent_id=pay.stripe_payment_intent_id AND duplicate.id<>pay.id) THEN RAISE EXCEPTION 'Ambiguous provider payment evidence'; END IF;
 IF EXISTS(SELECT 1 FROM stripe_refunds WHERE tenant_id=NEW.tenant_id AND checkout_transaction_id=NEW.payment_id AND status='SUCCEEDED' AND (amount<=0 OR upper(currency)<>NEW.currency)) THEN RAISE EXCEPTION 'Refund evidence is not valid for this currency'; END IF;
 SELECT coalesce(sum(net_minor),0) INTO paid FROM invoice_allocation_balances WHERE invoice_id=inv.id AND tenant_id=inv.tenant_id;
 SELECT NEW.amount_minor-coalesce((SELECT sum(amount) FROM stripe_refunds WHERE tenant_id=NEW.tenant_id AND checkout_transaction_id=NEW.payment_id AND status='SUCCEEDED'),0)
   -coalesce((SELECT sum(amount_minor) FROM checkout_payment_reversals WHERE tenant_id=NEW.tenant_id AND payment_id=NEW.payment_id),0) INTO net;
 IF net<=0 OR paid+net>inv.total_minor THEN RAISE EXCEPTION 'Payment exceeds the amount remaining'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_allocation_guard ON invoice_payment_allocations;
CREATE TRIGGER invoice_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_payment_allocations FOR EACH ROW EXECUTE FUNCTION guard_invoice_allocation();

CREATE OR REPLACE FUNCTION guard_offline_payment_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pay checkout_transactions%ROWTYPE; refunded bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Refund evidence is immutable'; END IF;
 SELECT * INTO pay FROM checkout_transactions WHERE id=NEW.payment_id AND tenant_id=NEW.tenant_id FOR UPDATE;
 IF pay.id IS NULL OR pay.purpose<>'invoice_payment' OR pay.stripe_payment_intent_id IS NOT NULL OR pay.payment_method NOT IN ('CASH','BANK_TRANSFER','EXTERNAL_CARD') OR pay.payment_status<>'SUCCEEDED' THEN RAISE EXCEPTION 'Use the original payment provider for this refund'; END IF;
 SELECT coalesce(sum(amount_minor),0) INTO refunded FROM checkout_payment_reversals WHERE tenant_id=NEW.tenant_id AND payment_id=NEW.payment_id;
 IF refunded+NEW.amount_minor>pay.total_amount THEN RAISE EXCEPTION 'Refund exceeds the payment'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_offline_refund_guard ON checkout_payment_reversals;
CREATE TRIGGER invoice_offline_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON checkout_payment_reversals FOR EACH ROW EXECUTE FUNCTION guard_offline_payment_reversal();

CREATE OR REPLACE FUNCTION guard_invoice_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv invoices%ROWTYPE; paid bigint;
BEGIN
 IF TG_TABLE_NAME='invoice_items' THEN
  IF TG_OP='UPDATE' AND (NEW.invoice_id<>OLD.invoice_id OR NEW.tenant_id<>OLD.tenant_id) THEN RAISE EXCEPTION 'Invoice items cannot be moved'; END IF;
  SELECT * INTO inv FROM invoices WHERE id=coalesce(NEW.invoice_id,OLD.invoice_id) FOR UPDATE;
  IF inv.status<>'DRAFT' THEN RAISE EXCEPTION 'Issued invoice lines are immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Void an invoice instead of deleting it'; END IF;
 IF OLD.status='VOID' OR (OLD.status='ISSUED' AND (NEW.status NOT IN ('ISSUED','VOID') OR (to_jsonb(NEW)-ARRAY['status','voided_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','voided_at','updated_at']))) THEN RAISE EXCEPTION 'Issued invoices are immutable'; END IF;
 IF NEW.status='ISSUED' AND OLD.status='DRAFT' THEN
  IF (SELECT coalesce(sum(total_minor),0) FROM invoice_items WHERE invoice_id=NEW.id AND tenant_id=NEW.tenant_id)<>NEW.total_minor THEN RAISE EXCEPTION 'Invoice lines do not match the total'; END IF;
 END IF;
 IF NEW.status='VOID' THEN
  SELECT paid_minor INTO paid FROM invoice_balances WHERE id=NEW.id;
  IF paid>0 THEN RAISE EXCEPTION 'Refund allocated payments before voiding'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_document_guard ON invoices;
CREATE TRIGGER invoice_document_guard BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION guard_invoice_document();
DROP TRIGGER IF EXISTS invoice_item_guard ON invoice_items;
CREATE TRIGGER invoice_item_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION guard_invoice_document();

-- Financial evidence already allocated cannot be rewritten under an invoice.
CREATE OR REPLACE FUNCTION guard_allocated_payment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM invoice_payment_allocations WHERE payment_id=OLD.id) THEN
  IF TG_OP='DELETE' OR NEW.total_amount<>OLD.total_amount OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.payment_status NOT IN ('SUCCEEDED','REFUNDED') OR (OLD.payment_status='REFUNDED' AND NEW.payment_status<>'REFUNDED') THEN RAISE EXCEPTION 'Allocated payment evidence cannot be rewritten'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_invoice_stripe_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pay checkout_transactions%ROWTYPE; refunded bigint;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF OLD.status='SUCCEEDED' AND EXISTS(SELECT 1 FROM invoice_payment_allocations WHERE payment_id=OLD.checkout_transaction_id) THEN
   IF TG_OP='DELETE' OR NEW.status<>'SUCCEEDED' OR NEW.amount<>OLD.amount OR NEW.checkout_transaction_id<>OLD.checkout_transaction_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.currency<>OLD.currency THEN RAISE EXCEPTION 'Allocated refund evidence cannot be rewritten'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF EXISTS(SELECT 1 FROM invoice_payment_allocations WHERE payment_id=NEW.checkout_transaction_id) THEN
  SELECT * INTO pay FROM checkout_transactions WHERE id=NEW.checkout_transaction_id FOR UPDATE;
  IF NEW.amount<=0 OR NEW.tenant_id<>pay.tenant_id OR upper(NEW.currency)<>pay.currency THEN RAISE EXCEPTION 'Invalid allocated refund evidence'; END IF;
  IF NEW.status='SUCCEEDED' THEN
   SELECT coalesce(sum(amount),0) INTO refunded FROM stripe_refunds WHERE checkout_transaction_id=pay.id AND tenant_id=pay.tenant_id AND status='SUCCEEDED' AND id<>NEW.id;
   IF refunded+NEW.amount>pay.total_amount THEN RAISE EXCEPTION 'Refund exceeds payment'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_payment_evidence_guard ON checkout_transactions;
CREATE TRIGGER invoice_payment_evidence_guard BEFORE UPDATE OR DELETE ON checkout_transactions FOR EACH ROW EXECUTE FUNCTION guard_allocated_payment_evidence();
DROP TRIGGER IF EXISTS invoice_refund_evidence_guard ON stripe_refunds;
CREATE TRIGGER invoice_refund_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON stripe_refunds FOR EACH ROW EXECUTE FUNCTION guard_invoice_stripe_refund();

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_payment_reversals ENABLE ROW LEVEL SECURITY;
-- API-only access; no browser/PostgREST grants or permissive policies.
REVOKE ALL ON invoice_balances,invoice_allocation_balances,invoices,invoice_items,invoice_payment_allocations,invoice_activity,invoice_settings,checkout_payment_reversals FROM PUBLIC;

CREATE INDEX IF NOT EXISTS invoices_tenant_due_reference ON invoices(tenant_id,due_at,public_reference);
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON invoice_balances,invoice_allocation_balances,invoices,invoice_items,invoice_payment_allocations,invoice_activity,invoice_settings,checkout_payment_reversals FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
