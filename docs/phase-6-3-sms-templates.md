# SMS templates

Templates live in `packages/notifications/src/sms`, are selected only by server-owned keys, identify `{salon} via KS OS`, and include opt-out wording. Supported keys are booking confirmed/rescheduled/cancelled, appointment reminder, form assigned/reminder, payment confirmed, and refund updated. GSM-7/UCS-2 encoding and estimated segments are calculated before sending; more than two segments is rejected. Never add medical details, answers, card data, internal IDs, or customer PII to templates.
