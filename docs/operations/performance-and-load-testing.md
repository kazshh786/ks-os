# Performance and load testing

Run only against an isolated staging environment with synthetic data and provider test modes. Record release, region, database tier, pool size, workers, dataset cardinality, test duration and network location. Use `k6 run tests/load/phase14-smoke.js` with `BASE_URL`, `VUS` and `DURATION`.

Proposed targets requiring approval: median API <200 ms, p95 <500 ms, p99 <1 s; booking completion p95 <2 s excluding provider redirects; error rate <1%; queue delay <60 s normally/<5 min peak; webhook acknowledgement p95 <500 ms; CPU <70%, memory <80%, pool utilisation <80% sustained.

Baseline API latency/error/throughput, database query duration/connections, booking/payment duration, worker duration/throughput/retries, oldest queue age, webhook latency, export duration, CPU and memory. Capture `EXPLAIN (ANALYZE, BUFFERS)` only in safe environments. Add indexes only for observed tenant-leading predicates and measure write cost. Existing list/export APIs are bounded and queue claims use `SKIP LOCKED`.

Concurrency scenarios must prove unique slot/capacity constraints, idempotent duplicate submission, cancellation release, hold expiry, payment/booking consistency, worker duplicate delivery and poison-message quarantine. Expand k6 scenarios for login, availability, booking/cancellation, test-mode payment initiation, webhook fixtures, dashboard and access exports once stable synthetic tokens are provisioned.

Caching must include tenant, permission context, query/filter/version and locale/timezone in keys. Never cache auth, privacy downloads, medical/form answers, mutable availability or payment state. Document TTL, invalidation and degraded behaviour before enabling.

