# Phase 6.3 transactional SMS report

KS OS owns one central Twilio account, UK reply-capable number, and Messaging Service. Tenants control only approved transactional categories, reminder timing, and their operational contact number. SMS uses a dedicated `sms_outbox` because Phase 6.2 is email-specific. Booking changes enqueue transactionally; a protected worker claims jobs with `SKIP LOCKED`. WhatsApp, OTP, marketing, voice, arbitrary text, custom senders, and general two-way chat are excluded.

Implemented: UK mobile normalisation, versioned templates, two-segment protection, signed delivery/inbound webhooks, status precedence, STOP/START/HELP synchronisation, owner settings/history, appointment reminders, limits in templates/retries, masked numbers, and backend-only provider configuration. Payment/refund templates exist but their settings default off.
