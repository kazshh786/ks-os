# Phase 6.1 public form security

Assignments use 32 random bytes encoded as base64url. Only SHA-256 hashes are stored. Default expiry is controlled by `FORM_ASSIGNMENT_EXPIRY_DAYS` (30, maximum 90). Regeneration replaces the hash; cancellation and expiry return safe failures.

Public responses expose salon branding and immutable form content only—no tenant/client/appointment/assignment/staff IDs. Retrieval is limited to 30/IP/minute; submissions to 10/IP/minute with a 256 KiB body limit. Tokens, answers, acknowledgement names and URLs are redacted from structured logs. Submission locks the assignment and atomically creates at most one immutable response. A client-generated idempotency UUID makes a retry of the same successful request safe.
