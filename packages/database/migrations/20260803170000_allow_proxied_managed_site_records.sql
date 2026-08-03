-- Cloudflare-managed website routes terminate TLS and proxy requests to the
-- shared renderer. Keep proxying forbidden for every other DNS classification.
ALTER TABLE site_domain_dns_records
  DROP CONSTRAINT IF EXISTS site_domain_dns_records_proxied_check;

ALTER TABLE site_domain_dns_records
  ADD CONSTRAINT site_domain_dns_records_proxied_check
  CHECK (
    proxied = false
    OR (
      managed_by_ks_os = true
      AND classification = 'WEBSITE'
      AND record_type IN ('A', 'CNAME')
    )
  ) NOT VALID;

ALTER TABLE site_domain_dns_records
  VALIDATE CONSTRAINT site_domain_dns_records_proxied_check;

COMMENT ON CONSTRAINT site_domain_dns_records_proxied_check
  ON site_domain_dns_records IS
  'Proxying is permitted only for KS OS-managed website A/CNAME routes; mail, verification, and preserved records remain DNS-only.';
