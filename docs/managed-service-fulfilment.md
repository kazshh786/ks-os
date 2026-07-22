# Managed-service fulfilment

`managed_deliverables` tracks website, SEO, analytics, content, paid media, domain, email and other work per tenant. It stores status, assignee, due date, estimated/actual minutes and integer minor-unit cost.

Every material change adds `managed_deliverable_activity`, preserving a status trail. `managed_deliverable_approvals` records client approval requests/responses, while `managed_service_time_entries` provide itemised effort and cost attribution.

Agency administrators and fulfilment administrators can manage work. Support administrators have read-only fulfilment visibility. Customer approval endpoints must use a separately authenticated, narrowly scoped link when added; agency users must never record an approval as though they were the client.

Workload analytics aggregate open deliverables, actual time and cost. These are operational measures and are not mixed into GoCardless MRR.

