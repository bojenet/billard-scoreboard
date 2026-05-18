-- Stress Simulation training sessions
-- Run in Supabase SQL Editor

create table if not exists public.training_stress_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_library_id uuid references public.training_position_library(id) on delete set null,
  position_page_index int not null default 0,
  position_title text not null default '',
  position_page_label text not null default '',
  discipline text not null default '',
  target_points int not null check (target_points > 0),
  ball_layout jsonb not null default '{}'::jsonb,
  line_paths jsonb not null default '[]'::jsonb,
  attempts jsonb not null default '[]'::jsonb,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_training_stress_sessions_user_created
  on public.training_stress_sessions(user_id, created_at desc);

create index if not exists idx_training_stress_sessions_position
  on public.training_stress_sessions(position_library_id);

create or replace function public.training_stress_sessions_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_training_stress_sessions_touch_updated_at on public.training_stress_sessions;
create trigger trg_training_stress_sessions_touch_updated_at
before update on public.training_stress_sessions
for each row execute function public.training_stress_sessions_touch_updated_at();

alter table public.training_stress_sessions enable row level security;

drop policy if exists "training_stress_sessions_select_own_or_admin" on public.training_stress_sessions;
create policy "training_stress_sessions_select_own_or_admin"
  on public.training_stress_sessions
  for select
  using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "training_stress_sessions_insert_own_or_admin" on public.training_stress_sessions;
create policy "training_stress_sessions_insert_own_or_admin"
  on public.training_stress_sessions
  for insert
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "training_stress_sessions_update_own_or_admin" on public.training_stress_sessions;
create policy "training_stress_sessions_update_own_or_admin"
  on public.training_stress_sessions
  for update
  using (auth.uid() = user_id or public.is_admin(auth.uid()))
  with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "training_stress_sessions_delete_own_or_admin" on public.training_stress_sessions;
create policy "training_stress_sessions_delete_own_or_admin"
  on public.training_stress_sessions
  for delete
  using (auth.uid() = user_id or public.is_admin(auth.uid()));
