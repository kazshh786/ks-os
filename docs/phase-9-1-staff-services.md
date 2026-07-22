# Phase 9.1 staff services

`staff_service_assignments` is the canonical eligibility join. `staff_pricing` remains pricing/duration override data and is not overloaded. Updates validate both tenant staff and tenant services, replace eligibility transactionally, reject duplicates, and never alter appointments. Availability requires an active assignment.
