-- Run in Supabase SQL Editor

create table if not exists public.calendar_settings (
  key text primary key,
  source_url text not null default '',
  season text not null default '2025/2026',
  public_view_enabled boolean not null default true,
  invitation_auto_send_enabled boolean not null default false,
  invitation_auto_send_days_before integer not null default 14,
  invitation_auto_send_time text not null default '08:00',
  invitation_auto_send_frequency text not null default 'daily',
  invitation_auto_send_limit integer not null default 10,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

alter table public.calendar_settings
  add column if not exists public_view_enabled boolean not null default true;

alter table public.calendar_settings
  add column if not exists invitation_auto_send_enabled boolean not null default false;

alter table public.calendar_settings
  add column if not exists invitation_auto_send_days_before integer not null default 14;

alter table public.calendar_settings
  add column if not exists invitation_auto_send_time text not null default '08:00';

alter table public.calendar_settings
  add column if not exists invitation_auto_send_frequency text not null default 'daily';

alter table public.calendar_settings
  add column if not exists invitation_auto_send_limit integer not null default 10;

alter table public.calendar_settings
  drop constraint if exists calendar_settings_invitation_auto_send_days_check;

alter table public.calendar_settings
  add constraint calendar_settings_invitation_auto_send_days_check
  check (invitation_auto_send_days_before between 0 and 365);

alter table public.calendar_settings
  drop constraint if exists calendar_settings_invitation_auto_send_time_check;

alter table public.calendar_settings
  add constraint calendar_settings_invitation_auto_send_time_check
  check (invitation_auto_send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

alter table public.calendar_settings
  drop constraint if exists calendar_settings_invitation_auto_send_frequency_check;

alter table public.calendar_settings
  add constraint calendar_settings_invitation_auto_send_frequency_check
  check (invitation_auto_send_frequency in ('daily', 'hourly', 'every_15_minutes'));

alter table public.calendar_settings
  drop constraint if exists calendar_settings_invitation_auto_send_limit_check;

alter table public.calendar_settings
  add constraint calendar_settings_invitation_auto_send_limit_check
  check (invitation_auto_send_limit between 1 and 25);

alter table public.calendar_settings
  add column if not exists source_url text not null default '';

alter table public.calendar_settings
  add column if not exists season text not null default '2025/2026';

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

insert into public.calendar_settings (
  key,
  source_url,
  season,
  public_view_enabled,
  invitation_auto_send_enabled,
  invitation_auto_send_days_before,
  invitation_auto_send_time,
  invitation_auto_send_frequency,
  invitation_auto_send_limit
)
values ('nbv_public_calendar', '', '2025/2026', true, false, 14, '08:00', 'daily', 10)
on conflict (key) do nothing;
