# Phase 7.2 event classification

Categories are EMAIL, SMS, AUTOMATION, PAYMENT, REFUND, STRIPE, PAYOUT, DISPUTE, FORM, APPOINTMENT, TEAM, and SYSTEM. Severities are INFO, WARNING, and CRITICAL. Lifecycle statuses are OPEN, ACKNOWLEDGED, RESOLVED, and DISMISSED.

Producers create only actionable permanent failures or deadline/action-required states. Temporary provider retries stay in their source outbox and do not create inbox noise.
