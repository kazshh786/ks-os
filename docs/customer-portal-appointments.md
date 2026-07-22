# Customer Portal — Appointments View

## Overview

The appointments section of the customer portal provides read-only access to a customer's booking history across all linked salons.

## Data Shown

| Field | Source | Notes |
|---|---|---|
| Service name | `services.name` | |
| Salon name | `tenants.name` | |
| Staff name | `users.name` | |
| Start time | `appointments.start_time` | Formatted in local timezone |
| Timezone | `tenants.timezone` | Used for display formatting |
| Status (customer-friendly) | `appointments.status` | See mapping below |
| Payment status | Derived from payment totals | |
| Quoted amount | `appointments.quoted_amount` | Minor currency units |
| Paid amount | Sum of settled payment transactions | |
| Outstanding amount | `quoted - paid` (min 0) | |
| Location | `appointments.booking_channel` | For mobile: formatted address |
| Booking reference | `appointments.public_reference` | Used in URL |
| Assigned forms | `form_assignments` | Summary only on list; full detail on appointment detail page |

## Fields Excluded (Never Returned)

- `appointments.notes` / `appointments.internal_note`
- `appointments.user_id` (staff UUID)
- `appointments.idempotency_key`
- Any Stripe identifiers

## Status Mapping

Internal statuses are translated to customer-friendly labels:

| Internal status | Customer label |
|---|---|
| `PENDING` | Awaiting confirmation |
| `CONFIRMED` | Confirmed |
| `CHECKED_IN` | Checked in |
| `IN_SERVICE` | In progress |
| `AWAITING_PAYMENT` | Payment due |
| `COMPLETED` | Completed |
| `CANCELLED` | Cancelled |
| `NO_SHOW` | Missed appointment |
| `BLOCKED` | **Hidden — never shown** |

## Filtering

The appointment list supports:

- `status` — one of `UPCOMING`, `PAST`, `CANCELLED`
- `business` — the business slug to filter by a specific linked salon
- `limit` — max results (1–100, default 50)

`UPCOMING` maps to: `startTime > now` AND status IN (PENDING, CONFIRMED, CHECKED_IN, IN_SERVICE, AWAITING_PAYMENT).
`PAST` maps to: status = COMPLETED or startTime < now.
`CANCELLED` maps to: status IN (CANCELLED, NO_SHOW).

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/customer/appointments` | List appointments (filterable) |
| GET | `/api/v1/customer/appointments/:bookingReference` | Single appointment detail |

## Frontend Routes

| Path | Component |
|---|---|
| `/customer/appointments` | `CustomerAppointmentsPage` |
| `/customer/appointments/:bookingReference` | `CustomerAppointmentDetailPage` |
