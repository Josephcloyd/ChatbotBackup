create extension if not exists pgcrypto;

alter table public.production_plans
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists status text not null default 'generated',
  add column if not exists requested_by text null,
  add column if not exists reviewed_by uuid null,
  add column if not exists reviewed_at timestamptz null,
  add column if not exists rejection_reason text null,
  add column if not exists archived_at timestamptz null,
  add column if not exists planning_start_date date null,
  add column if not exists planning_end_date date null,
  add column if not exists actual_start_date date null,
  add column if not exists actual_end_date date null,
  add column if not exists actual_hours numeric null,
  add column if not exists requested_team_size integer null,
  add column if not exists progress_percentage numeric not null default 0,
  add column if not exists priority text not null default 'normal',
  add column if not exists workbook_mode text not null default 'dynamic',
  add column if not exists generation_source text not null default 'whatsapp';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'production_plans_status_check') then
    alter table public.production_plans add constraint production_plans_status_check
      check (status in ('draft', 'generating', 'generated', 'under_review', 'approved', 'rejected', 'archived', 'failed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'production_plans_priority_check') then
    alter table public.production_plans add constraint production_plans_priority_check
      check (priority in ('low', 'normal', 'high', 'urgent'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'production_plans_workbook_mode_check') then
    alter table public.production_plans add constraint production_plans_workbook_mode_check
      check (workbook_mode in ('official_template', 'dynamic'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'production_plans_generation_source_check') then
    alter table public.production_plans add constraint production_plans_generation_source_check
      check (generation_source in ('whatsapp', 'dashboard', 'api', 'admin'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'production_plans_progress_check') then
    alter table public.production_plans add constraint production_plans_progress_check
      check (progress_percentage >= 0 and progress_percentage <= 100);
  end if;
end $$;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_roles_role_check check (role in ('user', 'admin'))
);

alter table public.user_roles add column if not exists active boolean not null default true;

create table if not exists public.plan_files (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_plans(id) on delete cascade,
  file_name text not null,
  file_type text not null default 'workbook',
  version integer not null default 1,
  file_size bigint null,
  storage_bucket text not null,
  storage_path text not null,
  created_by text null,
  created_at timestamptz not null default now(),
  unique (plan_id, version)
);

create table if not exists public.plan_generation_runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid null references public.production_plans(id) on delete set null,
  project_title text null,
  model_provider text null,
  model_name text null,
  prompt_version text null,
  status text not null default 'started',
  attempt_number integer null,
  duration_ms integer null,
  input_tokens integer null,
  output_tokens integer null,
  validation_error_count integer null,
  validation_errors jsonb null,
  error_message text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists production_plans_status_created_idx
  on public.production_plans (status, created_at desc);

create index if not exists production_plans_priority_created_idx
  on public.production_plans (priority, created_at desc);

create index if not exists plan_files_plan_version_idx
  on public.plan_files (plan_id, version desc);

create index if not exists plan_generation_runs_started_idx
  on public.plan_generation_runs (started_at desc);

alter table public.user_roles enable row level security;
alter table public.plan_files enable row level security;
alter table public.plan_generation_runs enable row level security;

comment on table public.user_roles is
  'Dashboard role mapping. Only user and admin are valid database roles; the UI displays user as Operator.';
