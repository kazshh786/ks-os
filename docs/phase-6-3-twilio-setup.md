# Twilio setup

Create one platform Messaging Service, attach the KS OS UK SMS-capable number, and enable Advanced Opt-Out. Point status callbacks to `/api/v1/webhooks/twilio/status` and inbound messages to `/api/v1/webhooks/twilio/inbound`. Configure the exact public HTTPS URLs in the matching environment variables because signature validation includes the URL. Use an API key SID/secret for production sends; retain the auth token only for signature validation/administration. Invoke `POST /api/v1/communications/sms/worker` from one scheduler with `Authorization: Bearer $SMS_WORKER_SECRET`.
