# Phase 8.2 report API

All endpoints require an authenticated owner and derive the tenant from `request.auth.tenantId`:

- `GET /api/v1/reports/appointments`
- `GET /api/v1/reports/clients`
- `GET /api/v1/reports/services`
- `GET /api/v1/reports/staff`
- `GET /api/v1/reports/products`
- `GET /api/v1/reports/stock`
- `GET /api/v1/reports/payments`
- `GET /api/v1/reports/refunds`
- `GET /api/v1/reports/forms`
- `GET /api/v1/reports/communications`

Time-bounded reports accept `period`, `from`, and `to`. Appropriate endpoints also accept strictly validated combinations of `search`, `status`, `staffId`, `serviceId`, `clientId`, `bookingChannel`, `paymentStatus`, `newOrReturning`, `lastVisitRange`, `source`, `method`, `channel`, `template`, `templateId`, and `versionId`. `limit` defaults to 50 and is capped at 100. `cursor` is an opaque, versioned token. Each endpoint has a fixed sort enum; arbitrary database column names are rejected.

Successful responses are `{ success: true, data }`. Data contains applied filter metadata, a report-specific summary, validated rows, pagination metadata, and generation time. Time-bounded responses also contain UTC boundaries, tenant timezone, and local dates. Stock instead contains an `asOf` timestamp.

Stable errors are:

- `REPORT_ACCESS_DENIED` (403)
- `REPORT_INVALID_PERIOD` (400)
- `REPORT_INVALID_FILTER` (400)
- `REPORT_INVALID_SORT` (400)
- `REPORT_RANGE_TOO_LARGE` (422)
- `REPORT_DATA_UNAVAILABLE` (404)
- `REPORT_QUERY_FAILED` (500)

Logs contain tenant ID, report category and duration, but not search input, recipients, client names, provider IDs, form data, or response bodies.
