# SMS opt-out management

Twilio Advanced Opt-Out remains enabled and signed inbound webhooks mirror STOP-family and START-family changes into the client transactional preference. STOP cancels pending appointment/form reminders without affecting email, bookings, or records. START restores transactional eligibility only; it never enables marketing. HELP/INFO and general replies receive a safe automated salon-contact response. Duplicate inbound Message SIDs are ignored.
