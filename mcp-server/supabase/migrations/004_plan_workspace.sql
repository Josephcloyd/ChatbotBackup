create extension if not exists pgcrypto;

create table if not exists public.plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_plans(id) on delete cascade,
  revision_number integer not null,
  parent_revision_id uuid null references public.plan_revisions(id) on delete set null,
  created_by text null,
  created_by_role text not null,
  revision_source text not null,
  user_instruction text null,
  change_summary text not null,
  plan_data jsonb not null,
  validation_result jsonb null,
  workbook_mode text not null,
  workbook_filename text null,
  workbook_storage_path text null,
  workbook_signed_url text null,
  created_at timestamptz not null default now(),
  unique (plan_id, revision_number)
);

create table if not exists public.plan_conversations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_plans(id) on delete cascade,
  revision_id uuid null references public.plan_revisions(id) on delete set null,
  user_id text null,
  role text not null,
  message_type text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_change_proposals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_plans(id) on delete cascade,
  based_on_revision_id uuid not null references public.plan_revisions(id) on delete cascade,
  request_summary text not null,
  proposal jsonb not null,
  status text not null default 'pending',
  created_by text null,
  applied_revision_id uuid null references public.plan_revisions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plan_revisions_created_by_role_check') then
    alter table public.plan_revisions add constraint plan_revisions_created_by_role_check
      check (created_by_role in ('operator', 'admin', 'system'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'plan_revisions_source_check') then
    alter table public.plan_revisions add constraint plan_revisions_source_check
      check (revision_source in ('initial_generation', 'user_modification', 'admin_edit', 'revision_restore'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'plan_revisions_workbook_mode_check') then
    alter table public.plan_revisions add constraint plan_revisions_workbook_mode_check
      check (workbook_mode in ('dynamic', 'template'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'plan_conversations_role_check') then
    alter table public.plan_conversations add constraint plan_conversations_role_check
      check (role in ('user', 'assistant', 'system'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'plan_conversations_message_type_check') then
    alter table public.plan_conversations add constraint plan_conversations_message_type_check
      check (message_type in ('user', 'assistant', 'clarification', 'proposal', 'validation', 'system'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'plan_change_proposals_status_check') then
    alter table public.plan_change_proposals add constraint plan_change_proposals_status_check
      check (status in ('pending', 'applied', 'cancelled'));
  end if;
end $$;

create index if not exists plan_revisions_plan_created_idx
  on public.plan_revisions (plan_id, revision_number desc);

create index if not exists plan_conversations_plan_created_idx
  on public.plan_conversations (plan_id, created_at asc);

create index if not exists plan_conversations_revision_idx
  on public.plan_conversations (revision_id);

create index if not exists plan_change_proposals_plan_status_idx
  on public.plan_change_proposals (plan_id, status, created_at desc);

alter table public.plan_revisions enable row level security;
alter table public.plan_conversations enable row level security;
alter table public.plan_change_proposals enable row level security;

drop policy if exists "plan_revisions_service_role_all" on public.plan_revisions;
drop policy if exists "plan_conversations_service_role_all" on public.plan_conversations;
drop policy if exists "plan_change_proposals_service_role_all" on public.plan_change_proposals;

create policy "plan_revisions_service_role_all"
  on public.plan_revisions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "plan_conversations_service_role_all"
  on public.plan_conversations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "plan_change_proposals_service_role_all"
  on public.plan_change_proposals for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.plan_revisions is
  'Immutable production-plan revisions. Application access is mediated by the backend service role and dashboard session checks.';

comment on table public.plan_conversations is
  'Per-plan communication messages for LifePlan workspaces.';

comment on table public.plan_change_proposals is
  'Structured plan-change proposals awaiting approval, cancellation, or application.';
