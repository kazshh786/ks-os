# Customer Portal — Forms

## Overview

The forms section allows customers to view and complete forms (consent forms, health questionnaires, etc.) that have been assigned to them by linked salons.

## Data Shown

| Field | Source |
|---|---|
| Form title | `form_versions.title_snapshot` |
| Description | `form_versions.description_snapshot` |
| Salon name | `tenants.name` |
| Version | `form_versions.version_number` |
| Status | `form_assignments.status` |
| Expiry | `form_assignments.expires_at` |
| Submission date | `client_form_submissions.submitted_at` |
| Form fields + options | `form_versions.schema_json` |
| Acknowledgement text | `form_versions.acknowledgement_text` |

## Form Access Control

A customer can only see form assignments that belong to their linked client record for the relevant tenant. The query JOINs through `customer_client_links`:

```sql
SELECT form_assignments.*
FROM form_assignments
JOIN customer_client_links
  ON customer_client_links.tenant_id = form_assignments.tenant_id
  AND customer_client_links.client_id = form_assignments.client_id
  AND customer_client_links.customer_account_id = :customerAccountId
  AND customer_client_links.status = 'ACTIVE'
WHERE form_assignments.public_reference = :ref
```

The portal uses `form_assignments.public_reference` (uuid) rather than the primary key `id` or the staff-facing token hash.

## Status Lifecycle

| Status | Customer display | Action available |
|---|---|---|
| PENDING | "Action needed" | Complete button |
| OPENED | "Action needed" | Complete button |
| SUBMITTED | "Completed {date}" | Read-only |
| EXPIRED | "Expired" | None |
| CANCELLED | "Cancelled" | None |

## Form Submission

The customer submits forms via `POST /api/v1/customer/forms/:assignmentReference/submissions`. This calls `FormsService.submitCustomerPortal()`, which:

1. Verifies the assignment belongs to the customer's linked client record.
2. Validates the submission against the form schema.
3. Inserts the submission with `submitted_from = 'CUSTOMER_PORTAL'`.
4. Marks the assignment `SUBMITTED`.
5. Fires the `FORM_SUBMITTED` business event (for automations).
6. Resolves any related operations issues (form-overdue alerts).

### Idempotency

The submission includes an `idempotencyKey` (UUID generated client-side per form session). If the same key is submitted twice, the second request returns the existing submission instead of creating a duplicate.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/customer/forms` | List all form assignments |
| GET | `/api/v1/customer/forms/:assignmentReference` | Form detail (schema + acknowledgement) |
| POST | `/api/v1/customer/forms/:assignmentReference/submissions` | Submit completed form |

## Frontend Routes

| Path | Component |
|---|---|
| `/customer/forms` | `CustomerFormsPage` |
| `/customer/forms/:assignmentReference` | `CustomerFormPage` |

## Supported Field Types

The same field types supported by the staff form builder are rendered in the customer portal:

- `SHORT_TEXT` → `<input type="text">`
- `LONG_TEXT` → `<textarea>`
- `EMAIL` → `<input type="email">`
- `PHONE` → `<input type="tel">`
- `DATE` → `<input type="date">`
- `YES_NO` / `CONSENT_CHECKBOX` → `<input type="checkbox">`
- `SINGLE_CHOICE` / `SELECT` → `<select>`
- `MULTIPLE_CHOICE` → multiple checkboxes
- `INFORMATION` → styled informational block (no input)
