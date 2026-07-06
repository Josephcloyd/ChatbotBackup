create extension if not exists pgcrypto;

create table if not exists public.production_plans (
  id uuid primary key default gen_random_uuid(),
  whatsapp_user_id text not null,
  project_description text not null,
  project_title text not null default '',
  summary text not null default '',
  phases jsonb not null default '[]'::jsonb,
  total_hours_estimate numeric not null default 0,
  recommended_team_size integer not null default 0,
  key_risks jsonb not null default '[]'::jsonb,
  next_steps jsonb not null default '[]'::jsonb,
  raw_plan jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists production_plans_user_created_idx
  on public.production_plans (whatsapp_user_id, created_at desc);

alter table public.production_plans enable row level security;

comment on table public.production_plans is
  'Generated production plans. Server writes use the Supabase service-role key; never expose that key to clients.';
