-- Repair the workspace test-data reset for Supabase-hosted PostgreSQL.
--
-- The original function attempted to disable all triggers, including PostgreSQL
-- system foreign-key triggers. Supabase correctly rejects that operation. This
-- replacement keeps referential integrity enabled, deletes activity in dependency
-- order, tolerates optional baselined tables that are absent, and preserves any
-- client protected by consent, privacy-request or legal-hold evidence.

CREATE OR REPLACE FUNCTION public.ks_reset_tenant_test_data(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  result jsonb;
  protected_clients integer := 0;
  deleted_clients integer := 0;
  target_table text;
  ordered_tables text[] := ARRAY[
    'task_activity',
    'tasks',
    'automation_action_runs',
    'automation_runs',
    'automation_event_outbox',
    'business_events',
    'checkout_payment_components',
    'stripe_refunds',
    'stripe_disputes',
    'stripe_payout_items',
    'stripe_payment_attempts',
    'stripe_payouts',
    'checkout_transactions',
    'report_schedule_runs',
    'report_export_jobs',
    'review_invitations',
    'customer_booking_action_idempotency',
    'customer_booking_change_history',
    'customer_booking_management_tokens',
    'client_form_submissions',
    'form_assignments',
    'customer_account_claims',
    'customer_client_links',
    'waitlist',
    'loyalty_ledger',
    'sms_outbox',
    'internal_notifications',
    'operations_issues',
    'email_outbox',
    'appointments'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ks-reset-test-data:' || p_tenant_id::text, 0));

  SELECT jsonb_build_object(
    'appointments', (SELECT count(*) FROM appointments WHERE tenant_id = p_tenant_id),
    'clients', (SELECT count(*) FROM clients WHERE tenant_id = p_tenant_id),
    'payments', (SELECT count(*) FROM checkout_transactions WHERE tenant_id = p_tenant_id),
    'formSubmissions', (SELECT count(*) FROM client_form_submissions WHERE tenant_id = p_tenant_id),
    'messages', (
      (SELECT count(*) FROM email_outbox WHERE tenant_id = p_tenant_id)
      + (SELECT count(*) FROM sms_outbox WHERE tenant_id = p_tenant_id)
      + (SELECT count(*) FROM internal_notifications WHERE tenant_id = p_tenant_id)
    ),
    'reviewInvitations', (SELECT count(*) FROM review_invitations WHERE tenant_id = p_tenant_id),
    'waitlistEntries', (SELECT count(*) FROM waitlist WHERE tenant_id = p_tenant_id),
    'generatedReports', (SELECT count(*) FROM report_export_jobs WHERE tenant_id = p_tenant_id)
  ) INTO result;

  IF to_regclass('public.site_review_invitations') IS NOT NULL THEN
    UPDATE site_review_invitations
    SET email_outbox_id = NULL
    WHERE email_outbox_id IN (
      SELECT id FROM email_outbox WHERE tenant_id = p_tenant_id
    );
  END IF;

  IF to_regclass('public.client_wallets') IS NOT NULL THEN
    DELETE FROM client_wallets
    WHERE client_id IN (SELECT id FROM clients WHERE tenant_id = p_tenant_id);
  END IF;

  FOREACH target_table IN ARRAY ordered_tables
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = target_table
           AND column_name = 'tenant_id'
       ) THEN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', target_table)
      USING p_tenant_id;
    END IF;
  END LOOP;

  SELECT count(*)::integer
  INTO protected_clients
  FROM clients c
  WHERE c.tenant_id = p_tenant_id
    AND (
      EXISTS (SELECT 1 FROM consent_records cr WHERE cr.client_id = c.id)
      OR EXISTS (SELECT 1 FROM privacy_requests pr WHERE pr.subject_client_id = c.id)
      OR EXISTS (SELECT 1 FROM legal_holds lh WHERE lh.subject_client_id = c.id)
    );

  DELETE FROM clients c
  WHERE c.tenant_id = p_tenant_id
    AND NOT EXISTS (SELECT 1 FROM consent_records cr WHERE cr.client_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM privacy_requests pr WHERE pr.subject_client_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM legal_holds lh WHERE lh.subject_client_id = c.id);
  GET DIAGNOSTICS deleted_clients = ROW_COUNT;

  RETURN jsonb_build_object(
    'reset', true,
    'removed', result || jsonb_build_object('clientsDeleted', deleted_clients),
    'protectedClientsRetained', protected_clients
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ks_reset_tenant_test_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ks_reset_tenant_test_data(uuid) TO service_role;

-- Keep both destructive workspace controls server-only.
REVOKE ALL ON FUNCTION public.ks_hard_delete_tenant_workspace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ks_hard_delete_tenant_workspace(uuid) TO service_role;
