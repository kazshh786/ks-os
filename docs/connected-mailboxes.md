# Connected Google Workspace and Zoho Mail mailboxes

## Deployment type

This feature requires **both Vercel and VPS deployment**.

- **Vercel:** owner-facing Connect, Reauthorise, Sync and Disconnect controls.
- **VPS:** OAuth callbacks, encrypted token storage, provider-native sending, inbound mailbox synchronisation and migration 54.

Apply migration order 54:

```text
20260731102000_connected_mailbox_timestamp.sql
```

The migration adds a non-secret authorization timestamp and a bounded mailbox-worker index to the existing encrypted `integration_connections` table. OAuth tokens remain only in `token_ciphertext`.

## Email responsibilities

Connected mailboxes are used for human conversations in the KS OS inbox:

- outbound replies are sent from the business's real Google Workspace or Zoho Mail address;
- customer replies are synchronised into the tenant-isolated KS OS inbox;
- provider message and thread IDs are retained for reply threading;
- disconnecting removes local access and attempts provider token revocation.

Resend remains the delivery service for automated booking notifications, forms, payments and marketing. A connected mailbox does not replace the Resend webhook or suppression handling.

## Google Workspace setup

Create a Google Cloud project owned by KS OS and configure the OAuth consent screen.

1. Enable the **Gmail API**.
2. Create an OAuth 2.0 **Web application** client.
3. Add this authorised redirect URI:

```text
https://api.kasimshah.com/api/v1/mailboxes/oauth/google/callback
```

4. Configure the consent screen for the intended customer organisations.
5. Request and approve these scopes:

```text
openid
email
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
```

6. Add the client credentials to `/srv/ks-os/.env`:

```dotenv
GOOGLE_MAIL_CLIENT_ID=
GOOGLE_MAIL_CLIENT_SECRET=
GOOGLE_MAIL_REDIRECT_URI=https://api.kasimshah.com/api/v1/mailboxes/oauth/google/callback
```

Google may require OAuth verification before external customer organisations can grant Gmail scopes. Keep the application in test mode only while using explicitly registered test users.

## Zoho Mail setup

Create a **Server-based Application** in the Zoho API Console.

1. Enable multi-data-centre support so customers hosted outside the default Zoho US data centre can connect.
2. Add this redirect URI:

```text
https://api.kasimshah.com/api/v1/mailboxes/oauth/zoho/callback
```

3. Configure these scopes:

```text
ZohoMail.accounts.READ
ZohoMail.folders.READ
ZohoMail.messages.READ
ZohoMail.messages.CREATE
```

4. Add the credentials to `/srv/ks-os/.env`:

```dotenv
ZOHO_MAIL_CLIENT_ID=
ZOHO_MAIL_CLIENT_SECRET=
ZOHO_MAIL_REDIRECT_URI=https://api.kasimshah.com/api/v1/mailboxes/oauth/zoho/callback
```

KS OS validates the Zoho account-server hostname returned during OAuth and derives the matching regional Mail API host.

## Mailbox sync worker

The API process runs a bounded mailbox synchronisation worker. Default settings:

```dotenv
MAILBOX_SYNC_ENABLED=true
MAILBOX_SYNC_INTERVAL_MS=30000
MAILBOX_SYNC_BATCH_SIZE=10
```

The worker:

- prevents overlapping runs inside the API process;
- reads only active Google or Zoho communication connections;
- applies a five-minute overlap to avoid missing messages at a polling boundary;
- relies on provider message IDs and the existing conversation unique index for deduplication;
- marks integrations as degraded or requiring reauthorisation after provider failures.

## Owner connection flow

1. Sign in as the business owner.
2. Open **Settings → Integrations**.
3. Select **Connect Google Workspace** or **Connect Zoho Mail**.
4. Sign in to the business mailbox and approve access.
5. Return to KS OS and confirm the exact business email is shown as connected.
6. Select **Sync now** and confirm any new customer email appears in **Inbox**.
7. Reply in KS OS and confirm the message appears in the provider's Sent folder and reaches the customer from the business address.

Only one connected email channel is active for a tenant at a time. Connecting a different mailbox disconnects the previous EMAIL channel while preserving historical conversations.

## VPS deployment

After merging to `main`:

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

The first deployment must use `APPLY_MIGRATIONS=1`. Restarting the API is also required after adding or changing OAuth environment variables.

## Production validation

For each provider and tenant:

1. Connect a real business mailbox.
2. Confirm no access or refresh token appears in API responses or application logs.
3. Send a new inbound email from a customer address and sync it.
4. Confirm it resolves only to the intended tenant and matching client.
5. Reply from KS OS and verify the exact connected business address is used.
6. Confirm reply threading in Gmail or Zoho.
7. Disconnect the mailbox and confirm future sending and synchronisation stop.
8. Reauthorise and confirm the connection returns to `CONNECTED`.
