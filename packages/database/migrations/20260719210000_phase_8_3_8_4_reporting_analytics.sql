-- Phase 8.3-8.4: private report exports and recurring report delivery.
-- REVIEWED LOCAL MIGRATION ONLY. Do not apply to production without explicit approval.

create table if not exists public.report_export_jobs (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_by_user_id uuid references public.users(id) on delete set null, report_type varchar(40) not null,
  filters_json jsonb not null default '{}'::jsonb, format varchar(10) not null default 'CSV', status varchar(20) not null default 'PENDING',
  file_storage_path varchar(500), download_filename varchar(180), row_count integer, file_size_bytes integer,
  requested_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz, expires_at timestamptz,
  failure_code varchar(80), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint report_export_jobs_report_type_check check (report_type in ('APPOINTMENTS','CLIENTS','SERVICES','STAFF_ACTIVITY','PRODUCTS','STOCK','PAYMENTS','REFUNDS','FORMS','COMMUNICATIONS')),
  constraint report_export_jobs_format_check check (format = 'CSV'),
  constraint report_export_jobs_status_check check (status in ('PENDING','PROCESSING','READY','FAILED','EXPIRED','CANCELLED')),
  constraint report_export_jobs_row_count_check check (row_count is null or row_count >= 0),
  constraint report_export_jobs_file_size_check check (file_size_bytes is null or file_size_bytes >= 0)
);
create index if not exists report_export_jobs_tenant_requested_idx on public.report_export_jobs(tenant_id, requested_at desc, id);
create index if not exists report_export_jobs_requested_by_idx on public.report_export_jobs(requested_by_user_id);
create index if not exists report_export_jobs_pending_idx on public.report_export_jobs(requested_at, id) where status='PENDING';
create index if not exists report_export_jobs_expiry_idx on public.report_export_jobs(expires_at, id) where status='READY';

create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  name varchar(120) not null, report_type varchar(40) not null, filters_json jsonb not null default '{}'::jsonb,
  frequency varchar(20) not null, timezone varchar(100) not null, delivery_time_local time not null,
  weekday integer, monthly_day varchar(10), recipient_user_ids jsonb not null default '[]'::jsonb,
  additional_recipient_emails jsonb not null default '[]'::jsonb, status varchar(20) not null default 'ACTIVE',
  next_run_at timestamptz, last_run_at timestamptz, created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint report_schedules_report_type_check check (report_type in ('APPOINTMENTS','CLIENTS','SERVICES','STAFF_ACTIVITY','PRODUCTS','STOCK','PAYMENTS','REFUNDS','FORMS','COMMUNICATIONS')),
  constraint report_schedules_frequency_check check (frequency in ('DAILY','WEEKLY','MONTHLY')),
  constraint report_schedules_status_check check (status in ('ACTIVE','PAUSED','DELETED')),
  constraint report_schedules_weekday_check check (weekday is null or weekday between 0 and 6),
  constraint report_schedules_monthly_day_check check (monthly_day is null or monthly_day in ('FIRST','LAST','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28')),
  constraint report_schedules_recurrence_check check ((frequency='DAILY') or (frequency='WEEKLY' and weekday is not null) or (frequency='MONTHLY' and monthly_day is not null)),
  constraint report_schedules_recipients_check check (jsonb_typeof(recipient_user_ids)='array' and jsonb_typeof(additional_recipient_emails)='array')
);
create index if not exists report_schedules_tenant_status_next_idx on public.report_schedules(tenant_id,status,next_run_at);
create index if not exists report_schedules_due_idx on public.report_schedules(next_run_at,id) where status='ACTIVE';
create index if not exists report_schedules_created_by_idx on public.report_schedules(created_by_user_id);

create table if not exists public.report_schedule_runs (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  schedule_id uuid not null references public.report_schedules(id) on delete restrict, scheduled_for timestamptz not null,
  status varchar(20) not null default 'QUEUED', report_export_job_id uuid references public.report_export_jobs(id) on delete set null,
  failure_code varchar(80), started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(),
  constraint report_schedule_runs_status_check check (status in ('QUEUED','PROCESSING','SUCCEEDED','FAILED')),
  constraint report_schedule_runs_occurrence_unique unique(schedule_id,scheduled_for)
);
create index if not exists report_schedule_runs_tenant_schedule_idx on public.report_schedule_runs(tenant_id,schedule_id,scheduled_for desc);
create index if not exists report_schedule_runs_export_job_idx on public.report_schedule_runs(report_export_job_id);

alter table public.report_export_jobs enable row level security;
alter table public.report_schedules enable row level security;
alter table public.report_schedule_runs enable row level security;
revoke all on table public.report_export_jobs, public.report_schedules, public.report_schedule_runs from anon, authenticated;

-- Supabase Storage is optional in ordinary PostgreSQL test environments. When present,
-- create a private, CSV-only bucket with a strict object-size ceiling.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    execute $storage$
      insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values ('report-exports','report-exports',false,10485760,array['text/csv'])
      on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types
    $storage$;
  end if;
end $$;
