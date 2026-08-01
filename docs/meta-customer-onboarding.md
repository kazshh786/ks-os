# Meta customer onboarding

KS OS uses one platform Meta app and stores a separate encrypted connection for each tenant. Business owners connect assets they own through Meta Login for Business. They never paste access tokens into KS OS.

## VPS environment

```dotenv
META_APP_ID=
META_APP_SECRET=
META_GRAPH_VERSION=v25.0
META_WEBHOOK_VERIFY_TOKEN=
META_LOGIN_CONFIG_ID=
```

`META_LOGIN_CONFIG_ID` is the public configuration ID created in Meta Login for Business / Embedded Signup. The App Secret and webhook token remain server-side only.

## Customer flow

1. The owner opens **Settings → Integrations**.
2. The owner selects **Connect Meta accounts**.
3. Meta authenticates the owner and asks them to choose the WhatsApp Business Account, registered phone number, Facebook Page and linked Instagram professional account they own.
4. Meta returns a short-lived authorisation code to the browser.
5. The KS OS API exchanges that code server-side and validates that the token belongs to the configured Meta app.
6. KS OS discovers the authorised assets, subscribes the app to their webhooks and stores provider tokens using the existing AES-256-GCM integration encryption.
7. Each tenant gets its own `integration_connections` and `communication_channels` records.

The Meta app and webhook are shared platform infrastructure. Customer tokens and channel records are tenant-specific.

## Billing model

The initial KS OS model is **customer-owned billing**:

- each customer owns their WhatsApp Business Account;
- each customer adds and manages its own Meta payment method;
- Meta charges the customer for billable WhatsApp template messages;
- KS OS charges only its normal subscription or usage fee;
- KS OS does not attach a shared line of credit and does not front Meta message charges.

A partner credit-line model can be introduced later, but that would make KS OS responsible for Meta's aggregated invoice and customer rebilling.

## External customer release requirements

Before customers who are not app admins, developers or testers can connect, the Meta app must be Live and the required permissions must have Advanced Access. Expected permissions include:

- `business_management`
- `whatsapp_business_management`
- `whatsapp_business_messaging`
- `pages_show_list`
- `pages_manage_metadata`
- `pages_messaging`
- `instagram_basic`
- `instagram_manage_messages`

Meta business verification, privacy policy, data deletion instructions, screencasts and app-review test credentials may also be required.

## Webhook

All tenants use the same callback:

```text
https://api.kasimshah.com/api/v1/webhooks/meta
```

The webhook routes events to a tenant by matching Meta's external account ID against a connected `communication_channels` record.

## Deployment

This feature is a **both** deployment:

- Vercel: Integrations UI and Meta Login for Business flow.
- VPS: code exchange, encrypted token storage, asset discovery, webhook subscriptions and channel delivery.

No database migration is required because the existing integration and communication-channel tables already support this model.
