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
  countdown_started_at timestamptz,
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

alter table public.training_countdown_hs_sessions
  add column if not exists countdown_started_at timestamptz;

alter table public.training_countdown_hs_sessions
  drop constraint if exists training_countdown_hs_sessions_duration_minutes_check;
alter table public.training_countdown_hs_sessions
  add constraint training_countdown_hs_sessions_duration_minutes_check
  check (duration_minutes in (30,45,60));

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

create table if not exists public.training_countdown_hs_messages (
  id bigserial primary key,
  session_id uuid not null references public.training_countdown_hs_sessions(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_name text,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists idx_countdown_hs_messages_session on public.training_countdown_hs_messages(session_id, created_at);
create index if not exists idx_countdown_hs_messages_sender on public.training_countdown_hs_messages(sender_user_id);

alter table public.training_countdown_hs_messages enable row level security;

drop policy if exists "countdown_hs_messages_select_participants" on public.training_countdown_hs_messages;
create policy "countdown_hs_messages_select_participants"
  on public.training_countdown_hs_messages
  for select
  using (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.training_countdown_hs_sessions s
      where s.id = training_countdown_hs_messages.session_id
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

drop policy if exists "countdown_hs_messages_insert_participants" on public.training_countdown_hs_messages;
create policy "countdown_hs_messages_insert_participants"
  on public.training_countdown_hs_messages
  for insert
  with check (
    sender_user_id = auth.uid()
    and (
      public.is_admin(auth.uid())
      or exists (
        select 1
        from public.training_countdown_hs_sessions s
        where s.id = training_countdown_hs_messages.session_id
          and (
            auth.uid() = s.host_user_id
            or auth.uid() = s.guest_user_id
            or (
              s.guest_email is not null
              and lower(s.guest_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
            )
          )
      )
    )
  );

drop policy if exists "countdown_hs_messages_delete_sender_or_admin" on public.training_countdown_hs_messages;
create policy "countdown_hs_messages_delete_sender_or_admin"
  on public.training_countdown_hs_messages
  for delete
  using (
    public.is_admin(auth.uid())
    or sender_user_id = auth.uid()
  );

create table if not exists public.training_challenge_results (
  source_key text primary key,
  mode text not null check (mode in ('solo', 'duel', 'go_on')),
  session_id uuid references public.training_countdown_hs_sessions(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_name text,
  opponent_name text,
  discipline text,
  duration_minutes int check (duration_minutes in (30,45,60)),
  target_points int check (target_points is null or target_points > 0),
  score int not null default 0,
  innings int not null default 0,
  series jsonb not null default '[]'::jsonb,
  high_series int not null default 0,
  avg numeric(10,3) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.training_challenge_results
  add column if not exists series jsonb not null default '[]'::jsonb;

alter table public.training_challenge_results
  add column if not exists target_points int;

alter table public.training_challenge_results
  drop constraint if exists training_challenge_results_duration_minutes_check;
alter table public.training_challenge_results
  add constraint training_challenge_results_duration_minutes_check
  check (duration_minutes is null or duration_minutes in (30,45,60));

alter table public.training_challenge_results
  drop constraint if exists training_challenge_results_target_points_check;
alter table public.training_challenge_results
  add constraint training_challenge_results_target_points_check
  check (target_points is null or target_points > 0);

alter table public.training_challenge_results
  drop constraint if exists training_challenge_results_mode_check;
alter table public.training_challenge_results
  add constraint training_challenge_results_mode_check
  check (mode in ('solo', 'duel', 'go_on'));

create index if not exists idx_training_challenge_owner on public.training_challenge_results(owner_user_id, created_at desc);
create index if not exists idx_training_challenge_session on public.training_challenge_results(session_id);

alter table public.training_challenge_results enable row level security;

drop policy if exists "training_challenge_results_select_own_or_admin" on public.training_challenge_results;
create policy "training_challenge_results_select_own_or_admin"
  on public.training_challenge_results
  for select
  using (
    public.is_admin(auth.uid())
    or owner_user_id = auth.uid()
  );

drop policy if exists "training_challenge_results_insert_own_or_admin" on public.training_challenge_results;
create policy "training_challenge_results_insert_own_or_admin"
  on public.training_challenge_results
  for insert
  with check (
    public.is_admin(auth.uid())
    or owner_user_id = auth.uid()
  );

drop policy if exists "training_challenge_results_update_own_or_admin" on public.training_challenge_results;
create policy "training_challenge_results_update_own_or_admin"
  on public.training_challenge_results
  for update
  using (
    public.is_admin(auth.uid())
    or owner_user_id = auth.uid()
  )
  with check (
    public.is_admin(auth.uid())
    or owner_user_id = auth.uid()
  );

drop policy if exists "training_challenge_results_delete_own_or_admin" on public.training_challenge_results;
create policy "training_challenge_results_delete_own_or_admin"
  on public.training_challenge_results
  for delete
  using (
    public.is_admin(auth.uid())
    or owner_user_id = auth.uid()
  );
