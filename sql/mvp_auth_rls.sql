-- MVP Auth + Ownership (Supabase SQL)
-- Run this in Supabase SQL Editor.

-- 1) Players: own profile mapping
alter table public.players
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_players_user_id on public.players(user_id);

-- 2) Matches: relation to users
alter table public.matches
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists player1_id uuid references auth.users(id) on delete set null,
  add column if not exists player2_id uuid references auth.users(id) on delete set null;

create index if not exists idx_matches_created_by on public.matches(created_by);
create index if not exists idx_matches_player1_id on public.matches(player1_id);
create index if not exists idx_matches_player2_id on public.matches(player2_id);

-- 3) Archive relation
alter table public.archive
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists idx_archive_created_by on public.archive(created_by);

-- 4) Enable RLS
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.archive enable row level security;

-- 5) Players policies
drop policy if exists "players_select_own" on public.players;
create policy "players_select_own"
  on public.players for select
  using (auth.uid() = user_id);

drop policy if exists "players_insert_own" on public.players;
create policy "players_insert_own"
  on public.players for insert
  with check (auth.uid() = user_id);

drop policy if exists "players_update_own" on public.players;
create policy "players_update_own"
  on public.players for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "players_delete_own" on public.players;
create policy "players_delete_own"
  on public.players for delete
  using (auth.uid() = user_id);

-- 6) Matches policies
drop policy if exists "matches_select_own" on public.matches;
create policy "matches_select_own"
  on public.matches for select
  using (
    auth.uid() = created_by
    or auth.uid() = player1_id
    or auth.uid() = player2_id
  );

drop policy if exists "matches_insert_own" on public.matches;
create policy "matches_insert_own"
  on public.matches for insert
  with check (
    auth.uid() = created_by
    or auth.uid() = player1_id
    or auth.uid() = player2_id
  );

drop policy if exists "matches_update_own" on public.matches;
create policy "matches_update_own"
  on public.matches for update
  using (
    auth.uid() = created_by
    or auth.uid() = player1_id
    or auth.uid() = player2_id
  )
  with check (
    auth.uid() = created_by
    or auth.uid() = player1_id
    or auth.uid() = player2_id
  );

drop policy if exists "matches_delete_own" on public.matches;
create policy "matches_delete_own"
  on public.matches for delete
  using (
    auth.uid() = created_by
    or auth.uid() = player1_id
    or auth.uid() = player2_id
  );

-- 7) Archive policies
drop policy if exists "archive_select_own" on public.archive;
create policy "archive_select_own"
  on public.archive for select
  using (
    auth.uid() = created_by
    or exists (
      select 1
      from public.matches m
      where m.id = archive."matchId"
        and (
          m.created_by = auth.uid()
          or m.player1_id = auth.uid()
          or m.player2_id = auth.uid()
        )
    )
  );

drop policy if exists "archive_insert_own" on public.archive;
create policy "archive_insert_own"
  on public.archive for insert
  with check (auth.uid() = created_by);

drop policy if exists "archive_update_own" on public.archive;
create policy "archive_update_own"
  on public.archive for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

drop policy if exists "archive_delete_own" on public.archive;
create policy "archive_delete_own"
  on public.archive for delete
  using (auth.uid() = created_by);
