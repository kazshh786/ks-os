# SMS security

Credentials and sender configuration are backend-only. Browser roles have no grants on `sms_outbox` or webhook-event tables; API queries are owner-only and tenant-scoped. Twilio signatures are validated against exact configured URLs. Logs redact phone/customer fields and never log message bodies. History omits template data and shows masked recipients. Sending uses only a server-owned Messaging Service SID, callback, validity period, and approved templates. There is no live-to-mock fallback.
