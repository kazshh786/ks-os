alter table if exists "automation_rules" rename to "automation_rules_legacy";
alter table if exists "automation_rules_legacy" enable row level security;
revoke all on table "automation_rules_legacy" from anon, authenticated;

create table "automation_rules" (
  "id" uuid primary key default gen_random_uuid(), "tenant_id" uuid not null references "tenants"("id") on delete cascade,
  "name" varchar(120) not null, "description" text not null default '', "status" varchar(20) not null default 'DRAFT',
  "trigger_type" varchar(60) not null, "trigger_config_json" jsonb not null default '{}'::jsonb,
  "conditions_json" jsonb not null default '[]'::jsonb, "created_by_user_id" uuid not null references "users"("id") on delete restrict,
  "updated_by_user_id" uuid not null references "users"("id") on delete restrict, "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(), "enabled_at" timestamptz, "disabled_at" timestamptz
);
create table "automation_rule_actions" (
  "id" uuid primary key default gen_random_uuid(), "tenant_id" uuid not null references "tenants"("id") on delete cascade,
  "automation_rule_id" uuid not null references "automation_rules"("id") on delete cascade, "position" integer not null,
  "action_type" varchar(60) not null, "action_config_json" jsonb not null default '{}'::jsonb,
  "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(),
  constraint "automation_rule_actions_rule_position_unique" unique ("automation_rule_id", "position")
);
create table "business_events" (
  "id" varchar(255) primary key, "tenant_id" uuid not null references "tenants"("id") on delete cascade,
  "event_type" varchar(60) not null, "source_type" varchar(50) not null, "source_id" uuid not null,
  "payload_json" jsonb not null default '{}'::jsonb, "status" varchar(20) not null default 'PENDING',
  "occurred_at" timestamptz not null, "created_at" timestamptz not null default now(), "processed_at" timestamptz,
  "next_attempt_at" timestamptz not null default now(), "attempt_count" integer not null default 0, "last_error_code" varchar(100)
);
create index "business_events_worker_idx" on "business_events" ("status", "next_attempt_at");
create table "automation_runs" (
  "id" uuid primary key default gen_random_uuid(), "tenant_id" uuid not null references "tenants"("id") on delete cascade,
  "automation_rule_id" uuid not null references "automation_rules"("id") on delete restrict, "trigger_type" varchar(60) not null,
  "trigger_event_id" varchar(255) not null, "source_type" varchar(50) not null, "source_id" uuid not null,
  "status" varchar(30) not null default 'PENDING', "started_at" timestamptz, "completed_at" timestamptz,
  "failed_at" timestamptz, "last_error_code" varchar(100), "created_at" timestamptz not null default now(),
  constraint "automation_runs_rule_event_unique" unique ("automation_rule_id", "trigger_event_id")
);
create table "automation_action_runs" (
  "id" uuid primary key default gen_random_uuid(), "tenant_id" uuid not null references "tenants"("id") on delete cascade,
  "automation_run_id" uuid not null references "automation_runs"("id") on delete cascade,
  "automation_rule_action_id" uuid not null references "automation_rule_actions"("id") on delete restrict,
  "status" varchar(30) not null default 'PENDING', "idempotency_key" varchar(255) not null unique,
  "attempt_count" integer not null default 0, "scheduled_for" timestamptz not null default now(), "next_attempt_at" timestamptz not null default now(),
  "started_at" timestamptz, "completed_at" timestamptz, "failed_at" timestamptz, "last_error_code" varchar(100),
  "result_reference_type" varchar(50), "result_reference_id" uuid, "created_at" timestamptz not null default now()
);
create index "automation_action_runs_worker_idx" on "automation_action_runs" ("status", "next_attempt_at", "scheduled_for");
create table "internal_notifications" (
  "id" uuid primary key default gen_random_uuid(), "tenant_id" uuid not null references "tenants"("id") on delete cascade,
  "recipient_user_id" uuid references "users"("id") on delete set null, "recipient_role" varchar(20), "type" varchar(60) not null,
  "title" varchar(160) not null, "message" varchar(500) not null, "source_type" varchar(50) not null, "source_id" uuid not null,
  "read_at" timestamptz, "created_at" timestamptz not null default now()
);

alter table "automation_rules" enable row level security;
alter table "automation_rule_actions" enable row level security;
alter table "business_events" enable row level security;
alter table "automation_runs" enable row level security;
alter table "automation_action_runs" enable row level security;
alter table "internal_notifications" enable row level security;
revoke all on "automation_rules", "automation_rule_actions", "business_events", "automation_runs", "automation_action_runs", "internal_notifications" from anon, authenticated;
