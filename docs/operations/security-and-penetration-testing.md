# Security operations and penetration testing

Production secrets live in the hosting secret manager and are unique per environment. Rotate database, Supabase server, worker, webhook, integration-encryption and audit-hash secrets through dual-secret/provider overlap where supported; deploy consumers before producers, verify, then revoke the old value. Supabase session invalidation requires local session revocation as well as provider sign-out. Never expose server keys through `VITE_` variables or CI output.

CI runs lockfile installation, production/full dependency audits, Gitleaks and CodeQL. Critical dependency findings fail; high production findings fail. Exceptions require owner, CVE, affected surface, compensating control and expiry. Dependabot groups minor/patch updates; major upgrades require compatibility review.

Penetration-test scope: web/API, tenant/agency/customer contexts, invitation/reset/MFA, IDOR/tenant isolation, support mode, bookings/concurrency, payments/refunds, files, exports, webhooks, worker authentication, rate limits and privacy workflows. Use staging with synthetic data and test-mode providers. No denial-of-service, destructive payloads, social engineering, production access or data exfiltration without written approval.

Role matrix includes unauthenticated, customer, tenant staff, tenant owner, fulfilment administrator, support administrator, agency administrator and platform owner. Severity: Critical—systemic auth bypass/RCE/payment or broad data compromise; High—cross-tenant or privileged compromise; Medium—limited exposure/control bypass; Low—hardening defect. Track finding, evidence, affected release, owner, due date, remediation commit, residual risk and independent retest. Preserve all test data securely and delete it after the agreed retention period.

Checklist: object-level authorization; context confusion; reset enumeration; MFA/session revocation; CSRF/CORS; XSS/CSP; SQL/command/SSRF/path injection; upload type/size; mass assignment; webhook signature/replay; idempotency/races; source maps; headers; cache control; sensitive logs; secret exposure; failure-rate monitoring.

