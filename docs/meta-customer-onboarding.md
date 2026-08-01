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

## WhatsApp package model

KS OS enforces WhatsApp features in the API as well as the interface.

### Core

- receives incoming WhatsApp messages;
- allows free-form staff replies only during the rolling 24-hour customer-service window;
- refreshes the window whenever the customer sends a new WhatsApp message;
- blocks WhatsApp replies after the window closes and recommends connected SMS or email channels;
- does not allow utility, authentication or marketing templates.

### Growth

- includes all Core capabilities;
- allows approved utility and authentication templates outside the customer-service window;
- supports appointment confirmations, reminders, form requests and payment links;
- does not allow marketing templates.

### Scale

- includes all Growth capabilities;
- allows approved marketing templates;
- requires recorded customer opt-in before a marketing template can be queued;
- allows the owner to record opt-in or opt-out evidence from the KS OS messaging controls;
- provides governed scheduled marketing campaigns.

The template catalogue is synced from the customer-owned WhatsApp Business Account. Only templates with Meta status `APPROVED` can be selected or sent.

## Scale marketing campaigns

The Scale campaign manager supports:

- immediate or scheduled campaigns;
- all opted-in customers;
- customers with an upcoming booking in the next 30 days;
- customers who have not completed a booking in the previous 90 days;
- approved Meta marketing templates and required template values;
- a maximum recipient count for each campaign;
- a configurable monthly workspace message limit, defaulting to 500;
- a seven-day frequency cap per recipient;
- queued, sent, delivered, read, failed and skipped reporting;
- cancellation while a campaign is still scheduled.

The existing protected conversation worker claims due campaigns, resolves the consent-qualified audience, creates WhatsApp conversations where required and places messages onto the normal delivery queue. The delivery path rechecks that the workspace is still on Scale and that consent remains `OPTED_IN` immediately before calling Meta.

## Billing model

The initial KS OS model is **customer-owned billing**:

- each customer owns their WhatsApp Business Account;
- each customer adds and manages its own Meta payment method;
- Meta charges the customer for billable WhatsApp template messages;
- KS OS charges only its normal subscription or usage fee;
- KS OS does not attach a shared line of credit and does not front Meta message charges.

A partner credit-line model can be introduced later, but that would make KS OS responsible for Meta's aggregated invoice and customer rebilling.

## Consent and compliance

Marketing consent is stored per tenant and recipient phone number. The record contains:

- current status: `OPTED_IN`, `OPTED_OUT` or `UNKNOWN`;
- source of the consent decision;
- structured evidence;
- opt-in and revocation timestamps;
- the KS OS user who recorded the change.

The Scale send path refuses marketing delivery unless the current status is `OPTED_IN`. A later opt-out prevents queued or future marketing delivery when the delivery worker rechecks consent.

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

The webhook routes events to a tenant by matching Meta's external account ID against a connected `communication_channels` record. WhatsApp inbound messages also extend that conversation's service-window expiry by 24 hours.

## Deployment

This feature is a **both** deployment:

- Vercel: Integrations UI, Meta Login for Business flow, package messaging controls, template composer and Scale campaign manager.
- VPS: code exchange, encrypted token storage, asset discovery, webhook subscriptions, service-window enforcement, template sync, consent checks, campaign dispatch and channel delivery.

Database migration `20260801033000_whatsapp_tier_messaging.sql` is required. It adds the service-window timestamp, monthly marketing limit, approved-template cache, marketing-consent evidence, scheduled campaigns and campaign recipient delivery records.
