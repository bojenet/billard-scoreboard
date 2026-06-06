-- Run in Supabase SQL Editor

create table if not exists public.calendar_settings (
  key text primary key,
  source_url text not null default '',
  season text not null default '2025/2026',
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

alter table public.calendar_settings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_settings'
      and policyname = 'calendar_settings public read'
  ) then
    create policy "calendar_settings public read"
    on public.calendar_settings
    for select
    to anon, authenticated
    using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_settings'
      and policyname = 'calendar_settings admin insert'
  ) then
    create policy "calendar_settings admin insert"
    on public.calendar_settings
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'admin'
      )
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_settings'
      and policyname = 'calendar_settings admin update'
  ) then
    create policy "calendar_settings admin update"
    on public.calendar_settings
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'admin'
      )
    )
    with check (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'admin'
      )
    );
  end if;
end
$$;

insert into public.calendar_settings (key, source_url, season)
values ('nbv_public_calendar', '', '2025/2026')
on conflict (key) do nothing;
