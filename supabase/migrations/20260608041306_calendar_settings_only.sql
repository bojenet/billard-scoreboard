create table if not exists public.calendar_settings (
  key text primary key,
  source_url text not null default '',
  season text not null default '2025/2026',
  public_view_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

alter table public.calendar_settings
  add column if not exists source_url text not null default '';

alter table public.calendar_settings
  add column if not exists season text not null default '2025/2026';

alter table public.calendar_settings
  add column if not exists public_view_enabled boolean not null default true;

alter table public.calendar_settings
  add column if not exists updated_at timestamptz not null default now();

alter table public.calendar_settings
  add column if not exists updated_by uuid null references auth.users(id) on delete set null;

alter table public.calendar_settings enable row level security;

drop policy if exists "calendar_settings public read" on public.calendar_settings;
create policy "calendar_settings public read"
on public.calendar_settings
for select
to anon, authenticated
using (true);

drop policy if exists "calendar_settings admin insert" on public.calendar_settings;
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

drop policy if exists "calendar_settings admin update" on public.calendar_settings;
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

insert into public.calendar_settings (key, source_url, season, public_view_enabled)
values ('nbv_public_calendar', '', '2025/2026', true)
on conflict (key) do nothing;