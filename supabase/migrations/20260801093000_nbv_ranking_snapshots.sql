create table if not exists public.nbv_ranking_snapshots (
  id text primary key,
  season text not null,
  discipline_id text not null,
  discipline_label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  loaded_tournament_count integer not null default 0,
  failed_count integer not null default 0,
  failed_messages text[] not null default '{}',
  updated_by uuid null references auth.users(id) on delete set null,
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season, discipline_id)
);

alter table public.nbv_ranking_snapshots
  add column if not exists discipline_label text not null default '';

alter table public.nbv_ranking_snapshots
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.nbv_ranking_snapshots
  add column if not exists loaded_tournament_count integer not null default 0;

alter table public.nbv_ranking_snapshots
  add column if not exists failed_count integer not null default 0;

alter table public.nbv_ranking_snapshots
  add column if not exists failed_messages text[] not null default '{}';

alter table public.nbv_ranking_snapshots
  add column if not exists updated_by uuid null references auth.users(id) on delete set null;

alter table public.nbv_ranking_snapshots
  add column if not exists updated_by_name text not null default '';

alter table public.nbv_ranking_snapshots
  add column if not exists created_at timestamptz not null default now();

alter table public.nbv_ranking_snapshots
  add column if not exists updated_at timestamptz not null default now();

create index if not exists nbv_ranking_snapshots_season_idx
  on public.nbv_ranking_snapshots (season, updated_at desc);

create index if not exists nbv_ranking_snapshots_discipline_idx
  on public.nbv_ranking_snapshots (discipline_id);

alter table public.nbv_ranking_snapshots enable row level security;

create or replace function public.set_nbv_ranking_snapshots_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = coalesce(new.updated_at, now());
  return new;
end;
$$;

drop trigger if exists nbv_ranking_snapshots_set_updated_at on public.nbv_ranking_snapshots;
create trigger nbv_ranking_snapshots_set_updated_at
before update on public.nbv_ranking_snapshots
for each row
execute function public.set_nbv_ranking_snapshots_updated_at();

drop policy if exists "nbv_ranking_snapshots authenticated select" on public.nbv_ranking_snapshots;
create policy "nbv_ranking_snapshots authenticated select"
  on public.nbv_ranking_snapshots
  for select
  to authenticated
  using (true);

drop policy if exists "nbv_ranking_snapshots calendar editors insert" on public.nbv_ranking_snapshots;
create policy "nbv_ranking_snapshots calendar editors insert"
  on public.nbv_ranking_snapshots
  for insert
  to authenticated
  with check (public.has_calendar_admin_access(auth.uid()));

drop policy if exists "nbv_ranking_snapshots calendar editors update" on public.nbv_ranking_snapshots;
create policy "nbv_ranking_snapshots calendar editors update"
  on public.nbv_ranking_snapshots
  for update
  to authenticated
  using (public.has_calendar_admin_access(auth.uid()))
  with check (public.has_calendar_admin_access(auth.uid()));

grant select on public.nbv_ranking_snapshots to authenticated;
grant insert, update on public.nbv_ranking_snapshots to authenticated;
