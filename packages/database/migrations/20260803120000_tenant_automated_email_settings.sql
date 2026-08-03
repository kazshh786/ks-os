CREATE TABLE IF NOT EXISTS public.tenant_email_automation_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_email_automation_settings_json_object_check
    CHECK (jsonb_typeof(settings_json) = 'object')
);

CREATE INDEX IF NOT EXISTS tenant_email_automation_settings_updated_by_idx
  ON public.tenant_email_automation_settings(updated_by_user_id)
  WHERE updated_by_user_id IS NOT NULL;

ALTER TABLE public.tenant_email_automation_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenant_email_automation_settings FROM anon, authenticated;

COMMENT ON TABLE public.tenant_email_automation_settings IS
  'Server-managed, tenant-scoped branding, automation flags and safe plain-text copy for transactional email.';
