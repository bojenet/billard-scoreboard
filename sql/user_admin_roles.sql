-- User Admin MVP: profiles + user_roles + policies
-- Run after sql/mvp_auth_rls.sql

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  position_library_access text not null default 'edit' check (position_library_access in ('hidden', 'read', 'edit')),
  training_access text not null default 'edit' check (training_access in ('hidden', 'read', 'edit')),
  tournament_access text not null default 'edit' check (tournament_access in ('hidden', 'read', 'edit')),
  created_at timestamptz not null default now()
);

alter table public.user_roles
  add column if not exists position_library_access text not null default 'edit';

alter table public.user_roles
  add column if not exists training_access text not null default 'edit';

alter table public.user_roles
  add column if not exists tournament_access text not null default 'edit';

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

create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_user_roles_role on public.user_roles(role);

-- Backfill existing users
insert into public.profiles (id, email)
select id, email
from auth.users
on conflict (id) do update
set email = excluded.email;

insert into public.user_roles (user_id, role, position_library_access, training_access, tournament_access)
select id, 'member', 'edit', 'edit', 'edit'
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

-- Auto create profile + default role on new auth user
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;

  insert into public.user_roles (user_id, role, position_library_access, training_access, tournament_access)
  values (new.id, 'member', 'edit', 'edit', 'edit')
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
