-- User Admin MVP: profiles + user_roles + policies
-- Run after sql/mvp_auth_rls.sql

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists full_name text;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  match_access text not null default 'edit' check (match_access in ('hidden', 'read', 'edit')),
  position_library_access text not null default 'edit' check (position_library_access in ('hidden', 'read', 'edit')),
  training_access text not null default 'edit' check (training_access in ('hidden', 'read', 'edit')),
  tournament_access text not null default 'edit' check (tournament_access in ('hidden', 'read', 'edit')),
  calendar_access text not null default 'edit' check (calendar_access in ('hidden', 'read', 'edit')),
  club_mobile_access text not null default 'hidden' check (club_mobile_access in ('hidden', 'edit')),
  admin_center_access boolean not null default false,
  stream_overlay_access boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.login_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

alter table public.user_roles
  add column if not exists match_access text not null default 'edit';

alter table public.user_roles
  add column if not exists position_library_access text not null default 'edit';

alter table public.user_roles
  add column if not exists training_access text not null default 'edit';

alter table public.user_roles
  add column if not exists tournament_access text not null default 'edit';

alter table public.user_roles
  add column if not exists calendar_access text not null default 'edit';

alter table public.user_roles
  add column if not exists club_mobile_access text not null default 'hidden';

alter table public.user_roles
  add column if not exists admin_center_access boolean not null default false;

alter table public.user_roles
  add column if not exists stream_overlay_access boolean not null default true;

alter table public.user_roles
  drop constraint if exists user_roles_match_access_check;

alter table public.user_roles
  add constraint user_roles_match_access_check
  check (match_access in ('hidden', 'read', 'edit'));

alter table public.user_roles
  drop constraint if exists user_roles_position_library_access_check;

alter table public.user_roles
  add constraint user_roles_position_library_access_check
  check (position_library_access in ('hidden', 'read', 'edit'));

alter table public.user_roles
  drop constraint if exists user_roles_training_access_check;

alter table public.user_roles
  add constraint user_roles_training_access_check
  check (training_access in ('hidden', 'read', 'edit'));

alter table public.user_roles
  drop constraint if exists user_roles_tournament_access_check;

alter table public.user_roles
  add constraint user_roles_tournament_access_check
  check (tournament_access in ('hidden', 'read', 'edit'));

alter table public.user_roles
  drop constraint if exists user_roles_calendar_access_check;

alter table public.user_roles
  add constraint user_roles_calendar_access_check
  check (calendar_access in ('hidden', 'read', 'edit'));

alter table public.user_roles
  drop constraint if exists user_roles_club_mobile_access_check;

alter table public.user_roles
  add constraint user_roles_club_mobile_access_check
  check (club_mobile_access in ('hidden', 'edit'));

create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_user_roles_role on public.user_roles(role);
create index if not exists idx_login_events_user_created on public.login_events(user_id, created_at desc);
create index if not exists idx_login_events_created on public.login_events(created_at desc);

-- Backfill existing users
insert into public.profiles (id, email)
select id, email
from auth.users
on conflict (id) do update
set email = excluded.email;

insert into public.user_roles (user_id, role, match_access, position_library_access, training_access, tournament_access, calendar_access, club_mobile_access, admin_center_access, stream_overlay_access)
select id, 'member', 'edit', 'edit', 'edit', 'edit', 'edit', 'hidden', false, true
from auth.users
on conflict (user_id) do nothing;

-- Helper: admin check
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = uid
      and ur.role = 'admin'
  );
$$;

grant execute on function public.is_admin(uuid) to authenticated;

create or replace function public.has_admin_center_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = uid
      and (
        ur.role = 'admin'
        or coalesce(ur.admin_center_access, false) = true
      )
  );
$$;

grant execute on function public.has_admin_center_access(uuid) to authenticated;

create or replace function public.calendar_access_mode(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when uid is null then 'hidden'
      when exists (
        select 1
        from public.user_roles ur
        where ur.user_id = uid
          and ur.role = 'admin'
      ) then 'edit'
      else coalesce((
        select case
          when lower(coalesce(ur.calendar_access, 'edit')) in ('hidden', 'read', 'edit')
            then lower(coalesce(ur.calendar_access, 'edit'))
          else 'edit'
        end
        from public.user_roles ur
        where ur.user_id = uid
        limit 1
      ), 'hidden')
    end;
$$;

create or replace function public.has_calendar_admin_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.calendar_access_mode(uid) = 'edit';
$$;

grant execute on function public.calendar_access_mode(uuid) to authenticated;
grant execute on function public.has_calendar_admin_access(uuid) to authenticated;

-- Auto create profile + default role on new auth user
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'display_name', '')), '')
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
    full_name = coalesce(public.profiles.full_name, excluded.full_name);

  insert into public.user_roles (user_id, role, match_access, position_library_access, training_access, tournament_access, calendar_access, club_mobile_access, stream_overlay_access)
  values (new.id, 'member', 'edit', 'edit', 'edit', 'edit', 'edit', 'hidden', true)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.login_events enable row level security;

-- profiles policies
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles
  for select
  using (auth.uid() = id or public.is_admin(auth.uid()));

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles
  for update
  using (auth.uid() = id or public.is_admin(auth.uid()))
  with check (auth.uid() = id or public.is_admin(auth.uid()));

drop policy if exists "profiles_insert_self_or_admin" on public.profiles;
create policy "profiles_insert_self_or_admin"
  on public.profiles
  for insert
  with check (auth.uid() = id or public.is_admin(auth.uid()));

-- user_roles policies
drop policy if exists "user_roles_select_own_or_admin" on public.user_roles;
create policy "user_roles_select_own_or_admin"
  on public.user_roles
  for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "user_roles_admin_insert" on public.user_roles;
create policy "user_roles_admin_insert"
  on public.user_roles
  for insert
  with check (public.is_admin(auth.uid()));

drop policy if exists "user_roles_admin_update" on public.user_roles;
create policy "user_roles_admin_update"
  on public.user_roles
  for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "user_roles_admin_delete" on public.user_roles;
create policy "user_roles_admin_delete"
  on public.user_roles
  for delete
  using (public.is_admin(auth.uid()));

-- login_events policies
drop policy if exists "login_events_insert_own" on public.login_events;
create policy "login_events_insert_own"
  on public.login_events
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "login_events_select_own_or_admin" on public.login_events;
create policy "login_events_select_own_or_admin"
  on public.login_events
  for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));
