alter table public.players
  add column if not exists email text,
  add column if not exists send_match_result_email boolean not null default false;

create index if not exists idx_players_email_lower
  on public.players (lower(email));
