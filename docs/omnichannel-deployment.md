# Omnichannel inbox deployment

## Deployment type

This feature requires **both Vercel and VPS deployment**.

- Vercel deploys the responsive customer inbox, channel readiness settings, booking/form actions and conversation UI.
- The VPS runs the authenticated conversation API, provider webhooks, delivery worker, Stripe payment-link action and database migration.

## Required database migration

Apply migration order 53:

```text
20260730223000_omnichannel_conversations.sql
```

The migration creates tenant-isolated channel, conversation, message and attachment tables, adds durable retry fields, restricts direct browser database access and extends encrypted integration credentials to communication providers.

## VPS environment

Existing Resend and Twilio variables remain required for those channels. Add these backend-only variables:

```dotenv
# Conversation delivery worker
CONVERSATION_WORKER_ENABLED=true
CONVERSATION_WORKER_INTERVAL_MS=5000
CONVERSATION_WORKER_BATCH_SIZE=20
CONVERSATION_WORKER_SECRET=generate-a-distinct-random-secret-at-least-32-characters

# Meta platform
META_APP_ID=
META_APP_SECRET=
META_GRAPH_VERSION=
META_WEBHOOK_VERIFY_TOKEN=generate-a-distinct-random-secret-at-least-32-characters
```

`META_GRAPH_VERSION` is deliberately configurable. Set it to the production version approved for the Meta app instead of relying on a hard-coded version in application code.

## Connected channel records

A channel is available to the inbox only when its `communication_channels` row has `status = 'CONNECTED'`.

- **Email:** `external_account_id` is the exact Resend receiving address used to route inbound replies to the tenant.
- **SMS:** `external_account_id` is the tenant's E.164 Twilio number or Messaging Service SID for outbound-only setups. Two-way inbound routing requires the E.164 receiving number.
- **WhatsApp:** `external_account_id` is the WhatsApp phone-number ID.
- **Instagram:** `external_account_id` is the connected Instagram professional account ID.
- **Facebook:** `external_account_id` is the connected Facebook Page ID.

Provider access tokens are never stored in `communication_channels`. `credentials_reference` points to an encrypted `integration_connections` record.

## Provider webhook URLs

```text
Resend:   https://<api-host>/api/v1/webhooks/resend
Twilio:   https://<api-host>/api/v1/webhooks/twilio/inbound
Twilio:   https://<api-host>/api/v1/webhooks/twilio/status
Meta:     https://<api-host>/api/v1/webhooks/meta
```

Meta webhook requests require `X-Hub-Signature-256`. Twilio requests retain signature validation. Resend requests retain Svix verification.

## Deployment commands

After PR merge:

```bash
cd /srv/ks-os

git status --short

DEPLOY_BRANCH=main pnpm deploy:vps:dry-run

DEPLOY_BRANCH=main APPLY_MIGRATIONS=1 \
bash scripts/deploy/deploy-vps.sh

sudo systemctl status ks-os-api --no-pager

curl -fsS http://127.0.0.1:5000/health
echo
```

Do not use `APPLY_MIGRATIONS=0` for the first deployment of this feature.

## Readiness checks

Before enabling a tenant channel:

1. Confirm the provider business asset belongs to the tenant.
2. Store the token through encrypted integration storage.
3. Register and verify provider webhooks.
4. Send a test outbound message and confirm its provider ID is persisted.
5. Confirm delivered/read or failed state is updated by the webhook.
6. Send an inbound message and confirm it resolves to the intended tenant and customer only.
7. Confirm booking, secure form, payment-link and booking-page actions from the conversation.

Meta business verification, required permissions and app review are external release prerequisites and cannot be bypassed by application code.
