alter table "tenants" add column if not exists "reply_to_email" varchar(255);
alter table "tenants" add column if not exists "sender_display_name" varchar(255);
alter table "tenants" add column if not exists "booking_confirmation_enabled" boolean not null default true;
alter table "tenants" add column if not exists "booking_cancellation_enabled" boolean not null default true;
alter table "tenants" add column if not exists "booking_reschedule_enabled" boolean not null default true;
alter table "tenants" add column if not exists "appointment_reminders_enabled" boolean not null default true;
alter table "tenants" add column if not exists "form_delivery_enabled" boolean not null default true;
alter table "tenants" add column if not exists "form_reminders_enabled" boolean not null default true;
alter table "tenants" add column if not exists "payment_confirmation_enabled" boolean not null default true;
alter table "tenants" add column if not exists "form_reminder_timing" varchar(50) not null default '24_hours_before_appointment';

create table if not exists "email_outbox" (
  "id" uuid primary key default gen_random_uuid(), "tenant_id" uuid references "tenants"("id") on delete cascade,
  "recipient_email" varchar(255) not null, "recipient_name" varchar(255), "reply_to_email" varchar(255),
  "template_key" varchar(255) not null, "template_version" varchar(50) not null default '1.0.0',
  "template_data_json" jsonb not null default '{}'::jsonb, "idempotency_key" varchar(255) not null unique,
  "status" varchar(50) not null default 'PENDING', "provider" varchar(50) not null default 'resend',
  "provider_message_id" varchar(255) unique, "scheduled_for" timestamp not null default now(),
  "attempt_count" integer not null default 0, "next_attempt_at" timestamp not null default now(),
  "last_error_code" varchar(255), "related_entity_type" varchar(100), "related_entity_id" uuid,
  "created_at" timestamp not null default now(), "sent_at" timestamp, "delivered_at" timestamp, "failed_at" timestamp
);
create index if not exists "email_outbox_worker_idx" on "email_outbox" ("status", "next_attempt_at");
alter table "email_outbox" enable row level security;
revoke all on table "email_outbox" from anon, authenticated;

create table if not exists "email_webhook_events" (
  "event_id" varchar(255) primary key, "event_type" varchar(100) not null, "provider_message_id" varchar(255),
  "received_at" timestamptz not null default now(), "processed_at" timestamptz
);
alter table "email_webhook_events" enable row level security;
revoke all on table "email_webhook_events" from anon, authenticated;

create table if not exists "email_suppressions" (
  "id" uuid primary key default gen_random_uuid(), "recipient_email_normalized" varchar(255) not null unique,
  "reason" varchar(30) not null, "created_at" timestamptz not null default now()
);
alter table "email_suppressions" enable row level security;
revoke all on table "email_suppressions" from anon, authenticated;
