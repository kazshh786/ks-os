-- Universal Sales / Pipeline / Quotes foundation.
-- Additive only: existing client records remain canonical CRM identities.

CREATE TABLE IF NOT EXISTS client_sales_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lifecycle varchar(20) NOT NULL DEFAULT 'CUSTOMER',
  source varchar(120),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_sales_profiles_lifecycle_check CHECK (lifecycle IN ('LEAD','PROSPECT','CUSTOMER','FORMER')),
  CONSTRAINT client_sales_profiles_client_unique UNIQUE (client_id)
);
CREATE INDEX IF NOT EXISTS client_sales_profiles_tenant_lifecycle_idx ON client_sales_profiles(tenant_id, lifecycle);
CREATE INDEX IF NOT EXISTS client_sales_profiles_tenant_owner_idx ON client_sales_profiles(tenant_id, owner_user_id);

CREATE TABLE IF NOT EXISTS sales_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  purpose varchar(30) NOT NULL DEFAULT 'SALES',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_pipelines_purpose_check CHECK (purpose = 'SALES')
);
CREATE INDEX IF NOT EXISTS sales_pipelines_tenant_purpose_idx ON sales_pipelines(tenant_id, purpose, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS sales_pipelines_one_default_per_tenant_idx ON sales_pipelines(tenant_id) WHERE is_default = true AND is_active = true;

CREATE TABLE IF NOT EXISTS sales_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES sales_pipelines(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  position integer NOT NULL,
  category varchar(20) NOT NULL DEFAULT 'OPEN',
  probability integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_pipeline_stages_category_check CHECK (category IN ('OPEN','WON','LOST')),
  CONSTRAINT sales_pipeline_stages_probability_check CHECK (probability BETWEEN 0 AND 100),
  CONSTRAINT sales_pipeline_stages_position_check CHECK (position >= 0),
  CONSTRAINT sales_pipeline_stages_pipeline_position_unique UNIQUE (pipeline_id, position)
);
CREATE INDEX IF NOT EXISTS sales_pipeline_stages_tenant_pipeline_idx ON sales_pipeline_stages(tenant_id, pipeline_id, is_active);

CREATE TABLE IF NOT EXISTS sales_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  pipeline_id uuid NOT NULL REFERENCES sales_pipelines(id) ON DELETE RESTRICT,
  stage_id uuid NOT NULL REFERENCES sales_pipeline_stages(id) ON DELETE RESTRICT,
  title varchar(255) NOT NULL,
  description text,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source varchar(120),
  estimated_value integer,
  currency varchar(3) NOT NULL DEFAULT 'GBP',
  expected_close_date timestamptz,
  closed_at timestamptz,
  closed_reason text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_opportunities_estimated_value_check CHECK (estimated_value IS NULL OR estimated_value >= 0)
);
CREATE INDEX IF NOT EXISTS sales_opportunities_tenant_updated_idx ON sales_opportunities(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sales_opportunities_tenant_owner_idx ON sales_opportunities(tenant_id, owner_user_id);
CREATE INDEX IF NOT EXISTS sales_opportunities_tenant_stage_idx ON sales_opportunities(tenant_id, stage_id);
CREATE INDEX IF NOT EXISTS sales_opportunities_tenant_client_idx ON sales_opportunities(tenant_id, client_id);

CREATE TABLE IF NOT EXISTS sales_opportunity_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES sales_opportunities(id) ON DELETE CASCADE,
  activity_type varchar(40) NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_value text,
  to_value text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_opportunity_activity_type_check CHECK (activity_type IN ('CREATED','STAGE_CHANGED','OWNER_CHANGED','VALUE_CHANGED','QUOTE_CREATED','QUOTE_SENT','QUOTE_ACCEPTED','QUOTE_DECLINED','WON','LOST'))
);
CREATE INDEX IF NOT EXISTS sales_opportunity_activity_opportunity_created_idx ON sales_opportunity_activity(tenant_id, opportunity_id, created_at);

CREATE TABLE IF NOT EXISTS sales_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES sales_opportunities(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  quote_number varchar(40) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  title varchar(255) NOT NULL,
  introduction text,
  terms text,
  currency varchar(3) NOT NULL DEFAULT 'GBP',
  subtotal integer NOT NULL DEFAULT 0,
  tax_total integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  valid_until timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by_name varchar(255),
  accepted_by_email varchar(255),
  declined_at timestamptz,
  declined_reason text,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_quotes_status_check CHECK (status IN ('DRAFT','SENT','ACCEPTED','DECLINED','EXPIRED','VOID')),
  CONSTRAINT sales_quotes_version_check CHECK (version >= 1),
  CONSTRAINT sales_quotes_money_check CHECK (subtotal >= 0 AND tax_total >= 0 AND total >= 0),
  CONSTRAINT sales_quotes_tenant_quote_number_unique UNIQUE (tenant_id, quote_number)
);
CREATE INDEX IF NOT EXISTS sales_quotes_tenant_opportunity_idx ON sales_quotes(tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS sales_quotes_tenant_status_idx ON sales_quotes(tenant_id, status);

CREATE TABLE IF NOT EXISTS sales_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
  description varchar(1000) NOT NULL,
  quantity integer NOT NULL,
  unit_amount integer NOT NULL,
  tax_rate_basis_points integer NOT NULL DEFAULT 0,
  subtotal integer NOT NULL,
  tax_amount integer NOT NULL,
  total integer NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_quote_items_quantity_check CHECK (quantity > 0),
  CONSTRAINT sales_quote_items_amounts_check CHECK (unit_amount >= 0 AND subtotal >= 0 AND tax_amount >= 0 AND total >= 0),
  CONSTRAINT sales_quote_items_tax_check CHECK (tax_rate_basis_points BETWEEN 0 AND 100000),
  CONSTRAINT sales_quote_items_quote_position_unique UNIQUE (quote_id, position)
);
CREATE INDEX IF NOT EXISTS sales_quote_items_tenant_quote_idx ON sales_quote_items(tenant_id, quote_id);

CREATE TABLE IF NOT EXISTS sales_quote_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES sales_quotes(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_quote_access_tokens_quote_idx ON sales_quote_access_tokens(tenant_id, quote_id);
