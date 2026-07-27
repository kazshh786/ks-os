-- Remove the legacy Phase 15.0-15.2 duplicate status check that conflicts
-- with the canonical Phase 15.6A site-job lifecycle. This reconciliation is
-- data-preserving and leaves the canonical site_jobs_status_valid constraint
-- as the sole status allow-list. The KS OS migration runner executes this file
-- and its ledger insert in one transaction.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
DECLARE
  site_jobs_relation regclass;
  canonical_definition text;
  canonical_validated boolean;
BEGIN
  site_jobs_relation := to_regclass('public.site_jobs');
  IF site_jobs_relation IS NULL THEN
    RAISE EXCEPTION 'public.site_jobs must exist before status reconciliation';
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid, true),
         constraint_row.convalidated
  INTO canonical_definition, canonical_validated
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = site_jobs_relation
    AND constraint_row.conname = 'site_jobs_status_valid'
    AND constraint_row.contype = 'c';

  IF canonical_definition IS NULL THEN
    RAISE EXCEPTION
      'Canonical constraint site_jobs_status_valid must exist before reconciliation';
  END IF;
  IF NOT canonical_validated THEN
    RAISE EXCEPTION
      'Canonical constraint site_jobs_status_valid must be validated';
  END IF;
  IF position('''LEASED''' IN canonical_definition) = 0 THEN
    RAISE EXCEPTION
      'Canonical constraint site_jobs_status_valid must permit LEASED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = site_jobs_relation
      AND constraint_row.conname = 'site_jobs_status_check'
      AND constraint_row.contype = 'c'
  ) THEN
    RAISE EXCEPTION
      'Obsolete constraint site_jobs_status_check must exist before reconciliation';
  END IF;
END
$preconditions$;

ALTER TABLE public.site_jobs
  DROP CONSTRAINT site_jobs_status_check;

DO $postconditions$
DECLARE
  site_jobs_relation regclass := 'public.site_jobs'::regclass;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = site_jobs_relation
      AND constraint_row.conname = 'site_jobs_status_check'
  ) THEN
    RAISE EXCEPTION 'Obsolete site_jobs_status_check was not removed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = site_jobs_relation
      AND constraint_row.conname = 'site_jobs_status_valid'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND position(
        '''LEASED''' IN pg_get_constraintdef(constraint_row.oid, true)
      ) > 0
  ) THEN
    RAISE EXCEPTION
      'Canonical site_jobs_status_valid was not preserved with LEASED support';
  END IF;
END
$postconditions$;
