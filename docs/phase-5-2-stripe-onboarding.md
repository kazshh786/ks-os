# Phase 5.2 Stripe Onboarding

## Onboarding Flow
The Stripe Connect onboarding flow is designed to be seamless for KS OS tenants.
1. **Initiation**: The tenant initiates the onboarding process from their KS OS dashboard.
2. **Redirection**: The tenant is securely redirected to Stripe's hosted onboarding flow.
3. **Information Gathering**: Stripe collects all necessary identity and banking information directly from the tenant.
4. **Return**: Upon completion or cancellation, the tenant is redirected back to the KS OS platform.
5. **Status Update**: The KS OS platform receives webhook events to update the connection status in real-time.

## Account Configurations
When a tenant creates a Connected Account, the platform configures it with the appropriate settings:
- **Capabilities**: Standard capabilities for card payments and transfers are requested.
- **Payouts**: Configured according to the tenant's preferences (e.g., daily automatic payouts).
- **Branding**: The tenant's business details are passed to Stripe for branding on customer bank statements.

## KS OS Connection Statuses
The KS OS platform maps Stripe's internal account requirements to clear connection statuses:
- `ACTION_REQUIRED`
- `PENDING_VERIFICATION`
- `ACTIVE`
- `REJECTED`
- `RESTRICTED`
