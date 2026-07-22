# Booking links and widget embedding

Use the existing public booking URL as an iframe boundary:

```html
<iframe src="https://book.example.com/book/my-business?source=website&campaign=summer" title="Book an appointment" loading="lazy" width="100%" height="760"></iframe>
```

Allow only explicit HTTPS origins through `WIDGET_ALLOWED_ORIGINS`; do not use `*` for privileged `postMessage` communication. The host should apply `frame-src https://book.example.com`. The widget must never send names, email, phone, medical data, or payment details to host analytics. Safe events are flow-stage names plus widget/source/medium/campaign identifiers.

The server remains authoritative for services, staff, locations, duration, price, capacity, availability, idempotency, payment state, consent, and session expiry. A stale slot returns the existing availability conflict and must send the user back to time selection. Keyboard focus, labelled controls, visible errors, reduced motion, responsive layout and a non-widget booking link are required.

Version embed URLs when breaking host-message contracts. Allowed-origin failures disable privileged messaging but do not reveal administrative data. Troubleshoot using the API request ID, browser CSP console, and exact origin including scheme and port.
