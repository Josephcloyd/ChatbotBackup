-- WhatsApp user and group IDs are external identifiers, not Supabase auth UUIDs.
-- Older/partial schemas may have created these columns as uuid, which rejects
-- values such as "120363427079155334@g.us".

do $$
declare
  constraint_name text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'production_plans'
      and column_name = 'whatsapp_user_id'
      and data_type <> 'text'
  ) then
    for constraint_name in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'production_plans'
        and c.contype = 'f'
        and exists (
          select 1
          from pg_attribute a
          where a.attrelid = t.oid
            and a.attname = 'whatsapp_user_id'
            and a.attnum = any(c.conkey)
            and not a.attisdropped
        )
    loop
      execute format(
        'alter table public.production_plans drop constraint %I',
        constraint_name
      );
    end loop;

    alter table public.production_plans
      alter column whatsapp_user_id drop default;

    alter table public.production_plans
      alter column whatsapp_user_id type text using whatsapp_user_id::text;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'production_plans'
      and column_name = 'requested_by'
      and data_type <> 'text'
  ) then
    for constraint_name in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'production_plans'
        and c.contype = 'f'
        and exists (
          select 1
          from pg_attribute a
          where a.attrelid = t.oid
            and a.attname = 'requested_by'
            and a.attnum = any(c.conkey)
            and not a.attisdropped
        )
    loop
      execute format(
        'alter table public.production_plans drop constraint %I',
        constraint_name
      );
    end loop;

    alter table public.production_plans
      alter column requested_by drop default;

    alter table public.production_plans
      alter column requested_by type text using requested_by::text;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plan_files'
      and column_name = 'created_by'
      and data_type <> 'text'
  ) then
    for constraint_name in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'plan_files'
        and c.contype = 'f'
        and exists (
          select 1
          from pg_attribute a
          where a.attrelid = t.oid
            and a.attname = 'created_by'
            and a.attnum = any(c.conkey)
            and not a.attisdropped
        )
    loop
      execute format(
        'alter table public.plan_files drop constraint %I',
        constraint_name
      );
    end loop;

    alter table public.plan_files
      alter column created_by drop default;

    alter table public.plan_files
      alter column created_by type text using created_by::text;
  end if;
end $$;

notify pgrst, 'reload schema';
