-- Workspace data controls: reset generated test activity or irreversibly purge a tenant.
-- Both functions are server-only. They use transactional trigger suspension so
-- append-only and immutable tenant records can be removed as one atomic purge.

CREATE OR REPLACE FUNCTION public.ks_reset_tenant_test_data(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  table_record record;
  result jsonb;
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

  CREATE TEMP TABLE ks_reset_tables(table_name text PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO ks_reset_tables(table_name) VALUES
    ('appointments'),
    ('automation_action_runs'),
    ('automation_event_outbox'),
    ('automation_runs'),
    ('business_events'),
    ('checkout_payment_components'),
    ('checkout_transactions'),
    ('client_form_submissions'),
    ('clients'),
    ('customer_account_claims'),
    ('customer_booking_action_idempotency'),
    ('customer_booking_change_history'),
    ('customer_booking_management_tokens'),
    ('customer_client_links'),
    ('email_outbox'),
    ('form_assignments'),
    ('internal_notifications'),
    ('loyalty_ledger'),
    ('operations_issues'),
    ('report_export_jobs'),
    ('report_schedule_runs'),
    ('review_invitations'),
    ('sms_outbox'),
    ('stripe_disputes'),
    ('stripe_payment_attempts'),
    ('stripe_payout_items'),
    ('stripe_payouts'),
    ('stripe_refunds'),
    ('task_activity'),
    ('tasks'),
    ('waitlist'),
    ('client_wallets');

  FOR table_record IN
    SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN ks_reset_tables selected ON selected.table_name = c.relname
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER ALL', table_record.qualified_name);
  END LOOP;

  BEGIN
    UPDATE site_review_invitations
    SET email_outbox_id = NULL
    WHERE email_outbox_id IN (
      SELECT id FROM email_outbox WHERE tenant_id = p_tenant_id
    );

    DELETE FROM client_wallets
    WHERE client_id IN (SELECT id FROM clients WHERE tenant_id = p_tenant_id);

    FOR table_record IN
      SELECT c.table_schema, c.table_name
      FROM information_schema.columns c
      JOIN ks_reset_tables selected ON selected.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
      ORDER BY c.table_name
    LOOP
      EXECUTE format('DELETE FROM %I.%I WHERE tenant_id = $1', table_record.table_schema, table_record.table_name)
      USING p_tenant_id;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    FOR table_record IN
      SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN ks_reset_tables selected ON selected.table_name = c.relname
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    LOOP
      EXECUTE format('ALTER TABLE %s ENABLE TRIGGER ALL', table_record.qualified_name);
    END LOOP;
    RAISE;
  END;

  FOR table_record IN
    SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN ks_reset_tables selected ON selected.table_name = c.relname
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE TRIGGER ALL', table_record.qualified_name);
  END LOOP;

  RETURN jsonb_build_object('reset', true, 'removed', result);
END;
$$;

CREATE OR REPLACE FUNCTION public.ks_hard_delete_tenant_workspace(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  table_record record;
  candidate_auth_ids uuid[];
  result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ks-hard-delete:' || p_tenant_id::text, 0));

  SELECT coalesce(array_agg(DISTINCT auth_user_id) FILTER (WHERE auth_user_id IS NOT NULL), ARRAY[]::uuid[])
  INTO candidate_auth_ids
  FROM users
  WHERE tenant_id = p_tenant_id;

  SELECT jsonb_build_object(
    'appointments', (SELECT count(*) FROM appointments WHERE tenant_id = p_tenant_id),
    'clients', (SELECT count(*) FROM clients WHERE tenant_id = p_tenant_id),
    'users', (SELECT count(*) FROM users WHERE tenant_id = p_tenant_id),
    'payments', (SELECT count(*) FROM checkout_transactions WHERE tenant_id = p_tenant_id),
    'sites', (SELECT count(*) FROM sites WHERE tenant_id = p_tenant_id)
  ) INTO result;

  UPDATE application_sessions
  SET selected_tenant_user_id = NULL,
      last_seen_at = now()
  WHERE selected_tenant_user_id IN (SELECT id FROM users WHERE tenant_id = p_tenant_id);

  CREATE TEMP TABLE ks_hard_delete_tables(table_name text PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO ks_hard_delete_tables(table_name)
  SELECT DISTINCT c.table_name
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id';

  INSERT INTO ks_hard_delete_tables(table_name) VALUES
    ('tenants'),
    ('client_wallets'),
    ('site_approval_decisions'),
    ('site_change_request_events'),
    ('site_review_activity'),
    ('site_review_comments'),
    ('site_review_invitations'),
    ('site_review_items'),
    ('site_review_participants'),
    ('site_review_sessions')
  ON CONFLICT DO NOTHING;

  FOR table_record IN
    SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN ks_hard_delete_tables selected ON selected.table_name = c.relname
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER ALL', table_record.qualified_name);
  END LOOP;

  BEGIN
    DELETE FROM site_approval_decisions d
    WHERE EXISTS (SELECT 1 FROM site_approvals a WHERE a.id = d.approval_id AND a.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM site_review_cycles r WHERE r.id = d.review_cycle_id AND r.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM site_versions v WHERE v.id = d.site_version_id AND v.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM users u WHERE u.id = d.tenant_user_id AND u.tenant_id = p_tenant_id);

    DELETE FROM site_change_request_events e
    WHERE EXISTS (SELECT 1 FROM site_change_requests c WHERE c.id = e.change_request_id AND c.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM site_review_cycles r WHERE r.id = e.review_cycle_id AND r.tenant_id = p_tenant_id);

    DELETE FROM site_review_activity a
    WHERE EXISTS (SELECT 1 FROM site_review_cycles r WHERE r.id = a.review_cycle_id AND r.tenant_id = p_tenant_id);

    DELETE FROM site_review_comments c
    WHERE EXISTS (SELECT 1 FROM site_review_cycles r WHERE r.id = c.review_cycle_id AND r.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM users u WHERE u.id = c.tenant_user_id AND u.tenant_id = p_tenant_id);

    DELETE FROM site_review_sessions s
    WHERE EXISTS (SELECT 1 FROM site_review_cycles r WHERE r.id = s.review_cycle_id AND r.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM sites site WHERE site.id = s.site_id AND site.tenant_id = p_tenant_id);

    DELETE FROM site_review_invitations i
    WHERE EXISTS (SELECT 1 FROM site_review_cycles r WHERE r.id = i.review_cycle_id AND r.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM email_outbox e WHERE e.id = i.email_outbox_id AND e.tenant_id = p_tenant_id);

    DELETE FROM site_review_items i
    WHERE EXISTS (SELECT 1 FROM site_review_cycles r WHERE r.id = i.review_cycle_id AND r.tenant_id = p_tenant_id);

    DELETE FROM site_review_participants p
    WHERE EXISTS (SELECT 1 FROM site_review_cycles r WHERE r.id = p.review_cycle_id AND r.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM users u WHERE u.id = p.tenant_user_id AND u.tenant_id = p_tenant_id);

    DELETE FROM client_wallets
    WHERE client_id IN (SELECT id FROM clients WHERE tenant_id = p_tenant_id);

    FOR table_record IN
      SELECT c.table_schema, c.table_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.column_name = 'tenant_id'
      ORDER BY c.table_name
    LOOP
      EXECUTE format('DELETE FROM %I.%I WHERE tenant_id = $1', table_record.table_schema, table_record.table_name)
      USING p_tenant_id;
    END LOOP;

    DELETE FROM tenants WHERE id = p_tenant_id;
  EXCEPTION WHEN OTHERS THEN
    FOR table_record IN
      SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN ks_hard_delete_tables selected ON selected.table_name = c.relname
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    LOOP
      EXECUTE format('ALTER TABLE %s ENABLE TRIGGER ALL', table_record.qualified_name);
    END LOOP;
    RAISE;
  END;

  FOR table_record IN
    SELECT format('%I.%I', n.nspname, c.relname) AS qualified_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN ks_hard_delete_tables selected ON selected.table_name = c.relname
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE TRIGGER ALL', table_record.qualified_name);
  END LOOP;

  RETURN jsonb_build_object(
    'deleted', true,
    'removed', result,
    'candidateAuthUserIds', to_jsonb(candidate_auth_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ks_reset_tenant_test_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ks_hard_delete_tenant_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ks_reset_tenant_test_data(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ks_hard_delete_tenant_workspace(uuid) TO service_role;
