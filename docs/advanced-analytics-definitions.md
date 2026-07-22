# Advanced analytics definitions

All periods use the Phase 8.1 tenant-timezone resolver, half-open UTC boundaries and a maximum of 366 local calendar days. Automatic trend grain is daily through 90 days, weekly through 210 days and monthly after that.

- Booking trend: appointment counts/statuses use appointment start date. `created bookings` is separately labelled and uses booking creation date.
- Revenue trend: gross recorded revenue is successful/refunded checkout transaction value; refunds are successful local refund rows; net recorded revenue is gross less refunds. It is not profit. Average transaction value is gross divided by successful recorded transactions.
- Retention: distinct clients whose first completed appointment inside the selected period is old enough for the whole selected 30/60/90/180-day observation window. The numerator completed another appointment after that visit and within the window.
- Rebooking: distinct clients with a completed appointment in the selected period who have a later future appointment currently in `CONFIRMED` status.
- Lead time: non-negative appointment start minus booking creation time. Median is primary; average and same-day, 1–3, 4–7, 8–14, 15–30 and 31+ day buckets are supporting detail.
- Service demand: appointments, completed/cancelled/no-show counts, unique clients and reliably linked successful transaction value by service.
- No-show patterns: terminal eligible appointments grouped by service, weekday, local time block, staff and booking channel.
- Staff utilisation trend: booked minutes from active/completed appointment states divided by recurring schedule minutes. Missing schedules produce unavailable utilisation, not fabricated availability.
- Client frequency: clients with one, two, three-to-five or six-plus completed appointments in the selected period.
- Revenue mix: successful recorded transactions by payment method and checkout purpose. No unrecorded allocation is invented.
- Forward bookings: confirmed future appointment count and quoted value over a horizon matching the selected period length. Booking pace compares bookings created in the selected period with its equal previous period.

Retention, rebooking, lead-time percentages and group rates require `ANALYTICS_MINIMUM_SAMPLE_SIZE` eligible observations (default 10). Below it the value is null with `INSUFFICIENT_DATA`; missing data is never displayed as zero. Cancellation timing is deliberately omitted because there is no reliable appointment-status history. Forward values are confirmed bookings already held, not guaranteed forecasts.
