create extension if not exists pgcrypto with schema extensions;

create table if not exists public.scoreboard_app_settings (
  id boolean primary key default true check (id = true),
  auth_user_id uuid null references auth.users(id) on delete set null,
  pin_hash text not null default '',
  failed_attempts integer not null default 0,
  locked_until timestamptz null,
  pin_updated_at timestamptz null,
  updated_at timestamptz not null default now()
);

create table if not exists public.scoreboard_app_devices (
  device_id uuid primary key,
  device_name text not null default 'Scoreboard-Gerät',
  user_agent text not null default '',
  session_id uuid null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null
);

alter table public.scoreboard_app_settings enable row level security;
alter table public.scoreboard_app_devices enable row level security;

revoke all on public.scoreboard_app_settings from anon, authenticated;
revoke all on public.scoreboard_app_devices from anon, authenticated;
grant all on public.scoreboard_app_settings to service_role;
grant all on public.scoreboard_app_devices to service_role;

create or replace function public.scoreboard_app_set_pin(pin_value text, technical_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if pin_value !~ '^\d{6}$' then
    raise exception 'Der Vereins-PIN muss aus genau sechs Ziffern bestehen.';
  end if;

  insert into public.scoreboard_app_settings (
    id,
    auth_user_id,
    pin_hash,
    failed_attempts,
    locked_until,
    pin_updated_at,
    updated_at
  ) values (
    true,
    technical_user_id,
    extensions.crypt(pin_value, extensions.gen_salt('bf', 11)),
    0,
    null,
    now(),
    now()
  )
  on conflict (id) do update set
    auth_user_id = excluded.auth_user_id,
    pin_hash = excluded.pin_hash,
    failed_attempts = 0,
    locked_until = null,
    pin_updated_at = now(),
    updated_at = now();
end;
$$;

create or replace function public.scoreboard_app_verify_pin(pin_value text)
returns table (success boolean, technical_user_id uuid, blocked_until timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings_row public.scoreboard_app_settings%rowtype;
  next_failed_attempts integer;
begin
  select * into settings_row
  from public.scoreboard_app_settings
  where id = true
  for update;

  if not found or settings_row.pin_hash = '' or settings_row.auth_user_id is null then
    return query select false, null::uuid, null::timestamptz;
    return;
  end if;

  if settings_row.locked_until is not null and settings_row.locked_until > now() then
    return query select false, null::uuid, settings_row.locked_until;
    return;
  end if;

  if extensions.crypt(pin_value, settings_row.pin_hash) = settings_row.pin_hash then
    update public.scoreboard_app_settings
    set failed_attempts = 0,
        locked_until = null,
        updated_at = now()
    where id = true;
    return query select true, settings_row.auth_user_id, null::timestamptz;
    return;
  end if;

  next_failed_attempts := coalesce(settings_row.failed_attempts, 0) + 1;
  update public.scoreboard_app_settings
  set failed_attempts = case when next_failed_attempts >= 5 then 0 else next_failed_attempts end,
      locked_until = case when next_failed_attempts >= 5 then now() + interval '15 minutes' else null end,
      updated_at = now()
  where id = true;

  return query
  select false,
         null::uuid,
         case when next_failed_attempts >= 5 then now() + interval '15 minutes' else null::timestamptz end;
end;
$$;

create or replace function public.scoreboard_app_revoke_all_sessions(technical_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  deleted_count integer;
begin
  delete from auth.sessions where user_id = technical_user_id;
  get diagnostics deleted_count = row_count;
  update public.scoreboard_app_devices
  set revoked_at = now()
  where revoked_at is null;
  return deleted_count;
end;
$$;

create or replace function public.scoreboard_app_revoke_device(device_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  deleted_count integer;
begin
  if device_session_id is null then
    return false;
  end if;
  delete from auth.sessions where id = device_session_id;
  get diagnostics deleted_count = row_count;
  update public.scoreboard_app_devices
  set revoked_at = now()
  where session_id = device_session_id;
  return deleted_count > 0;
end;
$$;

revoke all on function public.scoreboard_app_set_pin(text, uuid) from public, anon, authenticated;
revoke all on function public.scoreboard_app_verify_pin(text) from public, anon, authenticated;
revoke all on function public.scoreboard_app_revoke_all_sessions(uuid) from public, anon, authenticated;
revoke all on function public.scoreboard_app_revoke_device(uuid) from public, anon, authenticated;
grant execute on function public.scoreboard_app_set_pin(text, uuid) to service_role;
grant execute on function public.scoreboard_app_verify_pin(text) to service_role;
grant execute on function public.scoreboard_app_revoke_all_sessions(uuid) to service_role;
grant execute on function public.scoreboard_app_revoke_device(uuid) to service_role;

drop policy if exists "players_select_own" on public.players;
create policy "players_select_own_or_scoreboard"
  on public.players for select
  to authenticated
  using (
    auth.uid() = user_id
    or public.is_admin(auth.uid())
    or exists (
      select 1
      from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.club_mobile_access = 'edit'
    )
  );
