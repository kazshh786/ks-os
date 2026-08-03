# Transactional email production runbook

KS OS sends transactional email through a durable database outbox. Booking and
payment transactions only queue messages; the communications worker delivers
due messages through Resend. The automation worker schedules post-visit review
invitations before the same communications worker sends them.

## Resend domain

Use the dedicated sending subdomain notify.kasimshah.com. Add the SPF and DKIM
records exactly as Resend provides, then verify the domain in Resend. Configure
Resend to send webhook events to:

    https://api.kasimshah.com/api/v1/webhooks/resend

Subscribe to sent, delivered, delivery-delayed, bounced, complained and failed
email events. Store the signing secret only in the API server environment.

The platform uses these verified senders:

- auth@notify.kasimshah.com
- bookings@notify.kasimshah.com
- payments@notify.kasimshah.com
- forms@notify.kasimshah.com

The visible display name is the tenant business name. Reply-To is the address
configured by that business. A business cannot supply an arbitrary From domain
unless that domain is separately verified with Resend.

## Required server configuration

Production startup fails closed unless Resend, all sender addresses, the
webhook signing secret, the email outbox worker secret, the automation worker
secret and the review-invitation signing secret are configured. Generate
independent random values of at least 32 characters for each worker/signing
secret.

## Worker timer

Install the two units from scripts/deploy/systemd into /etc/systemd/system. The
checked-in service targets the production `ksdeploy` user, `/srv/ks-os` working
directory and pinned Node 24 runtime. Then run:

    sudo systemctl daemon-reload
    sudo systemctl enable --now ks-os-communications-worker.timer
    systemctl list-timers ks-os-communications-worker.timer

The timer runs every minute. Database claims use row locks and idempotency keys,
so overlapping invocations cannot send the same logical message twice.

## Release verification

Before production activation:

1. Apply the pending tenant automated-email settings migration.
2. Confirm the Resend domain is verified.
3. Confirm the timer is active and its last run succeeded.
4. Create one test booking more than three days ahead.
5. Verify one customer confirmation, one business confirmation, and two pending
   reminder rows.
6. Complete a test visit and verify the configured review invitation is queued.
7. Complete a successful test payment and verify both customer and business
   payment messages.
8. Confirm delivered webhook events update the outbox and a deliberate hard
   bounce creates a suppression.
