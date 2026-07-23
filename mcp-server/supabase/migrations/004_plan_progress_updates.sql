create table if not exists public.plan_progress_updates (
  id uuid not null default gen_random_uuid(),
  plan_id uuid not null,
  updated_by uuid not null,
  progress_percentage numeric not null check (progress_percentage >= 0 and progress_percentage <= 100),
  actual_start_date date,
  actual_end_date date,
  actual_hours numeric check (actual_hours >= 0),
  requested_team_size integer check (requested_team_size >= 0),
  note text,
  created_at timestamp with time zone not null default now(),
  constraint plan_progress_updates_pkey primary key (id),
  constraint plan_progress_updates_plan_id_fkey foreign key (plan_id) references public.production_plans(id) on delete cascade,
  constraint plan_progress_updates_updated_by_fkey foreign key (updated_by) references auth.users(id)
);

create index if not exists plan_progress_updates_plan_id_created_at_idx
  on public.plan_progress_updates (plan_id, created_at desc);

create index if not exists plan_progress_updates_updated_by_idx
  on public.plan_progress_updates (updated_by);

alter table public.plan_progress_updates enable row level security;
