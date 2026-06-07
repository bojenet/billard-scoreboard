-- Run in Supabase SQL Editor

create table if not exists public.calendar_settings (
  key text primary key,
  source_url text not null default '',
  season text not null default '2025/2026',
  public_view_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

alter table public.calendar_settings
add column if not exists public_view_enabled boolean not null default true;

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
          and (ur.role = 'admin' or lower(coalesce(ur.calendar_access, 'hidden')) = 'edit')
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
          and (ur.role = 'admin' or lower(coalesce(ur.calendar_access, 'hidden')) = 'edit')
      )
    )
    with check (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and (ur.role = 'admin' or lower(coalesce(ur.calendar_access, 'hidden')) = 'edit')
      )
    );
  end if;
end
$$;

insert into public.calendar_settings (key, source_url, season, public_view_enabled)
values ('nbv_public_calendar', '', '2025/2026', true)
on conflict (key) do nothing;
