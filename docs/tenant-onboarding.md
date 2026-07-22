# Tenant onboarding

Tenant creation is transactional: business, initial active plan assignment, onboarding record, twelve ordered stages and GoCardless billing account are created together.

Stages are: sale handover, contract, setup fee, Direct Debit, business profile, brand assets, catalogue, team and locations, payments, communications, training and launch. Each stage supports owner, status, due date, notes and an explicit blocker. `BLOCKED` requires a blocker note.

Launch runs and persists checks for an active owner, location, service, GoCardless mandate, setup-fee confirmation/waiver, active/trialling subscription, ready Stripe Connect account and completed pre-launch stages. A failed blocking check prevents activation. A successful launch activates the tenant and timestamps the onboarding and launch stage.

Stripe readiness is a launch check for customer appointment payments; it is not evidence of a KS OS subscription.

