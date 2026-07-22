# Supported hardware and reconciliation

Stripe Terminal is the only payment hardware aligned with the existing Stripe Connect architecture. Owners request a rate-limited connection token only for a locally enabled device assigned to their tenant and location. Amount/currency/booking PaymentIntent creation remains server-side; connection tokens are short-lived and are not device secrets. Use Stripe simulated readers in development and physical readers in staging before production.

An interrupted browser response is an unknown state, not a failed payment. Query Stripe/rely on the signed webhook, match PaymentIntent to booking and checkout transaction, and prevent a second collection while the first is processing. Reader reassignment, offline status, timeout, cancellation, refund and reconnect actions must be audited.

Receipts use browser print or PDF. Include business and transaction references, date, service/staff, subtotal, tax, discount, tip, total, method and refund status. Never print PAN, CVC, provider secrets, or internal notes. Mark reprints as duplicates and offer email/PDF fallback.

USB/Bluetooth keyboard-wedge barcode scanners are supported conceptually for booking/voucher/product lookup: buffer rapid input, accept a configured terminator, debounce duplicate scans, enforce lookup permissions, and retain manual entry. No WebUSB claim is made.

Cash drawers are not generically supported in browsers. Implement only through a named supported receipt-printer bridge or an approved native wrapper, with location/device scoping, staff permission, an audited reason for manual opening, and a documented manual fallback.
