# Resources and locations

Locations, staff-location assignments, service-location assignments, and resources are tenant scoped. Locations and resources use soft activation flags. Each tenant receives a primary placeholder location during migration so existing records remain valid while appointment and resource location references stay nullable during rollout.

Resources support a type, description, location, capacity, and active state. Stripe payment ownership and webhook handling are unchanged by this phase.

