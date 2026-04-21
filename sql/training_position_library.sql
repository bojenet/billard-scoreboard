create table if not exists public.training_position_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  discipline text not null,
  description text not null default '',
  ball_layout jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

drop trigger if exists trg_training_position_library_touch_updated_at on public.training_position_library;
create trigger trg_training_position_library_touch_updated_at
before update on public.training_position_library
for each row execute function public.training_position_library_touch_updated_at();

alter table public.training_position_library enable row level security;

drop policy if exists "training_position_library_select_own" on public.training_position_library;
create policy "training_position_library_select_own"
  on public.training_position_library
  for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "training_position_library_insert_own" on public.training_position_library;
create policy "training_position_library_insert_own"
  on public.training_position_library
  for insert
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "training_position_library_update_own" on public.training_position_library;
create policy "training_position_library_update_own"
  on public.training_position_library
  for update
  using (auth.uid() = user_id or public.is_admin(auth.uid()))
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "training_position_library_delete_own" on public.training_position_library;
create policy "training_position_library_delete_own"
  on public.training_position_library
  for delete
  using (auth.uid() = user_id or public.is_admin(auth.uid()));
