-- Remote match sessions with target score and position graphics
-- Run in Supabase SQL Editor

create table if not exists public.training_remote_match_sessions (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  host_name text,
  host_discipline text not null,
  guest_user_id uuid references auth.users(id) on delete set null,
  guest_email text,
  guest_name text,
  guest_discipline text,
  target_points int not null check (target_points > 0),
  status text not null default 'active' check (status in ('active','finished','cancelled')),
  active_player int not null default 1,
  challenge_positions jsonb not null default '[]'::jsonb,
  position_index int not null default 1,
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

alter table public.training_remote_match_sessions
  add column if not exists active_player int not null default 1;

alter table public.training_remote_match_sessions
  add column if not exists challenge_positions jsonb not null default '[]'::jsonb;

alter table public.training_remote_match_sessions
  add column if not exists position_index int not null default 1;

alter table public.training_remote_match_sessions
  drop constraint if exists training_remote_match_sessions_active_player_check;
alter table public.training_remote_match_sessions
  add constraint training_remote_match_sessions_active_player_check
  check (active_player in (1,2));

alter table public.training_remote_match_sessions
  drop constraint if exists training_remote_match_sessions_position_index_check;
alter table public.training_remote_match_sessions
  add constraint training_remote_match_sessions_position_index_check
  check (position_index between 1 and 6);

create index if not exists idx_remote_match_host on public.training_remote_match_sessions(host_user_id);
create index if not exists idx_remote_match_guest_user on public.training_remote_match_sessions(guest_user_id);
create index if not exists idx_remote_match_guest_email on public.training_remote_match_sessions(lower(guest_email));
create index if not exists idx_remote_match_status on public.training_remote_match_sessions(status);

create or replace function public.training_remote_match_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_remote_match_touch_updated_at on public.training_remote_match_sessions;
create trigger trg_remote_match_touch_updated_at
before update on public.training_remote_match_sessions
for each row execute function public.training_remote_match_touch_updated_at();

alter table public.training_remote_match_sessions enable row level security;

drop policy if exists "remote_match_select_participants" on public.training_remote_match_sessions;
create policy "remote_match_select_participants"
  on public.training_remote_match_sessions
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

drop policy if exists "remote_match_insert_host" on public.training_remote_match_sessions;
create policy "remote_match_insert_host"
  on public.training_remote_match_sessions
  for insert
  with check (
    public.is_admin(auth.uid())
    or auth.uid() = host_user_id
  );

drop policy if exists "remote_match_update_participants" on public.training_remote_match_sessions;
create policy "remote_match_update_participants"
  on public.training_remote_match_sessions
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

drop policy if exists "remote_match_delete_host_admin" on public.training_remote_match_sessions;
create policy "remote_match_delete_host_admin"
  on public.training_remote_match_sessions
  for delete
  using (
    public.is_admin(auth.uid())
    or auth.uid() = host_user_id
  );

create table if not exists public.training_remote_match_messages (
  id bigserial primary key,
  session_id uuid not null references public.training_remote_match_sessions(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_name text,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists idx_remote_match_messages_session on public.training_remote_match_messages(session_id, created_at);

alter table public.training_remote_match_messages enable row level security;

drop policy if exists "remote_match_messages_select_participants" on public.training_remote_match_messages;
create policy "remote_match_messages_select_participants"
  on public.training_remote_match_messages
  for select
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.training_remote_match_sessions s
      where s.id = training_remote_match_messages.session_id
        and (
          auth.uid() = s.host_user_id
          or auth.uid() = s.guest_user_id
          or (
            s.guest_email is not null
            and lower(s.guest_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
        )
    )
  );

drop policy if exists "remote_match_messages_insert_participants" on public.training_remote_match_messages;
create policy "remote_match_messages_insert_participants"
  on public.training_remote_match_messages
  for insert
  with check (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.training_remote_match_sessions s
      where s.id = training_remote_match_messages.session_id
        and (
          auth.uid() = s.host_user_id
          or auth.uid() = s.guest_user_id
          or (
            s.guest_email is not null
            and lower(s.guest_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
        )
    )
  );
