# Phase 8.1 analytics API

`GET /api/v1/dashboard/overview` requires an authenticated owner. The tenant ID is always `request.auth.tenantId`; client-supplied tenant identifiers are ignored because none are accepted.

Query presets are `TODAY`, `YESTERDAY`, `LAST_7_DAYS`, `LAST_30_DAYS`, `THIS_MONTH`, `LAST_MONTH`, and `CUSTOM`. Custom queries require inclusive `from` and `to` ISO dates and are limited to 366 calendar days. Response period timestamps are UTC half-open boundaries and include tenant timezone plus local date labels. Previous comparison boundaries immediately precede the requested period with equal calendar-day length.

Stable errors are `ANALYTICS_ACCESS_DENIED` (403), `ANALYTICS_INVALID_PERIOD` (400), `ANALYTICS_RANGE_TOO_LARGE` (422), and `ANALYTICS_QUERY_FAILED` (500). Responses contain no client PII, form answers, medical data, payment credentials, or provider secrets.
