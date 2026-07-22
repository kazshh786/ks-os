# Phase 9.1 staff schedules

Standard hours reuse `staff_schedules`; channel hours reuse `booking_channel_schedules` with only `in_shop|mobile`. Times remain tenant-local `HH:mm` wall-clock values. Phase 9.1 supports one interval per staff/day/channel, validates day/time order, and replaces each schedule transactionally. Existing tenant timezone conversion remains in the availability service.
