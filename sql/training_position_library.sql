create table if not exists public.training_position_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  discipline text not null,
  description text not null default '',
  ball_layout jsonb not null default '{}'::jsonb,
  line_paths jsonb not null default '[]'::jsonb,
  position_pages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.training_position_library
  add column if not exists line_paths jsonb not null default '[]'::jsonb;

alter table public.training_position_library
  add column if not exists position_pages jsonb not null default '[]'::jsonb;

create index if not exists idx_training_position_library_user on public.training_position_library(user_id, updated_at desc);
create index if not exists idx_training_position_library_user_discipline on public.training_position_library(user_id, discipline);

create or replace function public.training_position_library_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.position_library_access_mode()
returns text
language plpgsql
stable
as $$
declare
  configured_value text;
begin
  if to_regclass('public.app_settings') is null then
    return 'edit';
  end if;

  select s.value
    into configured_value
    from public.app_settings s
   where s.key = 'position_library_access'
   limit 1;

  configured_value := lower(coalesce(configured_value, 'edit'));
  if configured_value not in ('hidden', 'read', 'edit') then
    configured_value := 'edit';
  end if;
  return configured_value;
end;
$$;

create or replace function public.position_library_can_view(uid uuid)
returns boolean
language sql
stable
as $$
  select public.is_admin(uid) or public.position_library_access_mode() <> 'hidden';
$$;

create or replace function public.position_library_can_edit(uid uuid)
returns boolean
language sql
stable
as $$
  select public.is_admin(uid) or public.position_library_access_mode() = 'edit';
$$;

grant execute on function public.position_library_access_mode() to authenticated;
grant execute on function public.position_library_can_view(uuid) to authenticated;
grant execute on function public.position_library_can_edit(uuid) to authenticated;

drop trigger if exists trg_training_position_library_touch_updated_at on public.training_position_library;
create trigger trg_training_position_library_touch_updated_at
before update on public.training_position_library
for each row execute function public.training_position_library_touch_updated_at();

alter table public.training_position_library enable row level security;

drop policy if exists "training_position_library_select_own" on public.training_position_library;
create policy "training_position_library_select_own"
  on public.training_position_library
  for select
  using ((auth.uid() = user_id or public.is_admin(auth.uid())) and public.position_library_can_view(auth.uid()));

drop policy if exists "training_position_library_insert_own" on public.training_position_library;
create policy "training_position_library_insert_own"
  on public.training_position_library
  for insert
  with check ((auth.uid() = user_id or public.is_admin(auth.uid())) and public.position_library_can_edit(auth.uid()));

drop policy if exists "training_position_library_update_own" on public.training_position_library;
create policy "training_position_library_update_own"
  on public.training_position_library
  for update
  using ((auth.uid() = user_id or public.is_admin(auth.uid())) and public.position_library_can_edit(auth.uid()))
  with check ((auth.uid() = user_id or public.is_admin(auth.uid())) and public.position_library_can_edit(auth.uid()));

drop policy if exists "training_position_library_delete_own" on public.training_position_library;
create policy "training_position_library_delete_own"
  on public.training_position_library
  for delete
  using ((auth.uid() = user_id or public.is_admin(auth.uid())) and public.position_library_can_edit(auth.uid()));
