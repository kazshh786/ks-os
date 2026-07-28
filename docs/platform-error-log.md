# Platform error log

`platform_error_events` is the append-only technical evidence ledger for failures handled by the KS OS API.

## Purpose

The error log answers five debugging questions:

1. **What failed?** Error code, type, sanitised message, HTTP status and retryability.
2. **Where did it fail?** API method and route, source component, first application stack frame, function, line and column.
3. **Who was affected?** Tenant user, agency user, authenticated identity, support session or public request classification.
4. **Which workspace was affected?** Tenant ID and the workspace name resolved only when an authorised support user views the log.
5. **How can the request be traced?** Request ID, correlation ID, error fingerprint, session context and timestamp.

## Capture policy

The central Fastify error handler records:

- every server failure (`5xx`);
- failures affecting an authenticated tenant or agency user;
- anonymous conflict, upload-size and rate-limit failures (`409`, `413`, `429`).

Routine anonymous validation, authentication and not-found responses are excluded to reduce noise and avoid building unnecessary visitor history.

## Privacy and security

The ledger never stores request bodies, raw query values, raw route parameters, cookies, authorisation headers, passwords, tokens, card details, bank information, medical notes or customer-form answers.

Only safe structural context is retained: parameter names, query-field names, body-field names and whether the request was made through an audited support session. Error messages and stacks are length-limited and sanitised for connection strings, credentials, JWTs, email addresses, payment-like numbers and URL queries before insertion.

The database table:

- has row-level security enabled;
- grants no browser-role access;
- permits `service_role` to select and insert only;
- rejects updates and deletes through an append-only trigger.

The agency API requires the existing `support.read` capability for list and detail access. Human display names and workspace names are joined at read time rather than copied into the evidence record.

## Debugging workflow

1. Ask the affected person for the request reference shown in the UI.
2. Open **Agency → Operations → Error log**.
3. Search the request ID, error code, fingerprint or route.
4. Inspect the source location and sanitised stack.
5. Correlate repeated fingerprints to identify the same underlying defect.
6. Use the audit log separately when the investigation needs to establish which administrative action changed data.

The audit log answers **who changed what**. The error log answers **what broke, where it broke and who experienced it**.

## Deployment

Migration `20260728010000_platform_error_log.sql` must be applied before deploying the API code. The migration is additive and does not alter or delete existing data.
