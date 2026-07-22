# Phase 8.2 report permissions and security

Phase 8.2 deliberately grants every report only to the existing `owner` role. Staff receive `REPORT_ACCESS_DENIED`; no report permission is inferred from page visibility or existing appointment/client access. Both React routes and API handlers enforce owner access, but the API is authoritative.

Every SQL statement contains the authenticated tenant UUID. Browser queries accept no tenant ID. Joins additionally match tenant IDs where tenant-owned records meet. There is no cross-tenant cache and no external Stripe, Twilio, Resend, or Supabase Data API request during report loading; the API reads local Postgres records over the server connection.

List contracts are strict and omit medical notes, appointment notes, mobile addresses, client email/phone, form answers, acknowledgement names, token hashes, public tokens, message bodies, template data, secure links, internal refund notes, Stripe identifiers, Twilio SIDs, Resend IDs, provider payloads, secrets, and arbitrary URLs. Recipients are masked before rows leave SQL. Drill-down URLs use fixed application route patterns plus validated UUIDs.

Sort values are endpoint-specific enums. No user-provided database identifier is placed into SQL. Search text and filters are parameterised. Cursor payloads contain only a validated version and bounded offset.

The 2026 Supabase Data API grant change does not affect these reports: Phase 8.2 creates no table/view/function and accesses Postgres through the server database connection. No new public Data API surface or RLS policy was added.
