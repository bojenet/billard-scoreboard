-- Countdown HS Multiplayer Sessions
-- Run in Supabase SQL Editor

create table if not exists public.training_countdown_hs_sessions (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  host_name text,
  host_discipline text not null,
  guest_user_id uuid references auth.users(id) on delete set null,
  guest_email text,
  guest_name text,
  guest_discipline text,
  duration_minutes int not null check (duration_minutes in (30,45,60)),
  status text not null default 'active' check (status in ('active','finished','cancelled')),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  host_series jsonb not null default '[]'::jsonb,
  guest_series jsonb not null default '[]'::jsonb,
  host_score int not null default 0,
  guest_score int not null default 0,
  host_innings int not null default 0,
  guest_innings int not null default 0,
  host_high int not null default 0,
  guest_high int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_countdown_hs_host on public.training_countdown_hs_sessions(host_user_id);
create index if not exists idx_countdown_hs_guest_user on public.training_countdown_hs_sessions(guest_user_id);
create index if not exists idx_countdown_hs_guest_email on public.training_countdown_hs_sessions(lower(guest_email));
create index if not exists idx_countdown_hs_status on public.training_countdown_hs_sessions(status);

create or replace function public.training_countdown_hs_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_countdown_hs_touch_updated_at on public.training_countdown_hs_sessions;
create trigger trg_countdown_hs_touch_updated_at
before update on public.training_countdown_hs_sessions
for each row execute function public.training_countdown_hs_touch_updated_at();

alter table public.training_countdown_hs_sessions enable row level security;

drop policy if exists "countdown_hs_select_participants" on public.training_countdown_hs_sessions;
create policy "countdown_hs_select_participants"
  on public.training_countdown_hs_sessions
  for select
  using (
    public.is_admin(auth.uid())
    or auth.uid() = host_user_id
    or auth.uid() = guest_user_id
    or (
      guest_email is not null
      and lower(guest_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "countdown_hs_insert_host" on public.training_countdown_hs_sessions;
create policy "countdown_hs_insert_host"
  on public.training_countdown_hs_sessions
  for insert
  with check (
    public.is_admin(auth.uid())
    or auth.uid() = host_user_id
  );

drop policy if exists "countdown_hs_update_participants" on public.training_countdown_hs_sessions;
create policy "countdown_hs_update_participants"
  on public.training_countdown_hs_sessions
  for update
  using (
    public.is_admin(auth.uid())
    or auth.uid() = host_user_id
    or auth.uid() = guest_user_id
    or (
      guest_email is not null
      and lower(guest_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  with check (
    public.is_admin(auth.uid())
    or auth.uid() = host_user_id
    or auth.uid() = guest_user_id
    or (
      guest_email is not null
      and lower(guest_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

drop policy if exists "countdown_hs_delete_host_admin" on public.training_countdown_hs_sessions;
create policy "countdown_hs_delete_host_admin"
  on public.training_countdown_hs_sessions
  for delete
  using (
    public.is_admin(auth.uid())
    or auth.uid() = host_user_id
  );
