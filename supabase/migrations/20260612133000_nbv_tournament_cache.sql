create table if not exists public.nbv_tournament_cache (
  source_url text primary key,
  payload jsonb not null,
  content_hash text not null,
  event_date date null,
  fetched_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.nbv_tournament_cache
  add column if not exists payload jsonb not null default '{}'::jsonb;

alter table public.nbv_tournament_cache
  add column if not exists content_hash text not null default '';

alter table public.nbv_tournament_cache
  add column if not exists event_date date null;

alter table public.nbv_tournament_cache
  add column if not exists fetched_at timestamptz not null default now();

alter table public.nbv_tournament_cache
  add column if not exists last_checked_at timestamptz not null default now();

alter table public.nbv_tournament_cache
  add column if not exists last_changed_at timestamptz not null default now();

alter table public.nbv_tournament_cache
  add column if not exists created_at timestamptz not null default now();

alter table public.nbv_tournament_cache
  add column if not exists updated_at timestamptz not null default now();

create index if not exists nbv_tournament_cache_event_date_idx
  on public.nbv_tournament_cache (event_date);

create index if not exists nbv_tournament_cache_last_checked_idx
  on public.nbv_tournament_cache (last_checked_at);

alter table public.nbv_tournament_cache enable row level security;

create or replace function public.set_nbv_tournament_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists nbv_tournament_cache_set_updated_at on public.nbv_tournament_cache;
create trigger nbv_tournament_cache_set_updated_at
before update on public.nbv_tournament_cache
for each row
execute function public.set_nbv_tournament_cache_updated_at();
