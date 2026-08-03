-- Canonical booking data is imported into fact finding for agency review. The
-- original Phase 15.7B constraint predates that governed source classification.
ALTER TABLE fact_finding_responses
  DROP CONSTRAINT IF EXISTS fact_finding_responses_source_check;

ALTER TABLE fact_finding_responses
  ADD CONSTRAINT fact_finding_responses_source_check
  CHECK (source IN ('CLIENT_PROVIDED', 'AGENCY_PROVIDED', 'BOOKING_SYSTEM'))
  NOT VALID;

ALTER TABLE fact_finding_responses
  VALIDATE CONSTRAINT fact_finding_responses_source_check;

COMMENT ON CONSTRAINT fact_finding_responses_source_check
  ON fact_finding_responses IS
  'Responses may originate from clients, agency-assisted entry, or canonical booking data; every value still requires the normal agency review lifecycle.';
