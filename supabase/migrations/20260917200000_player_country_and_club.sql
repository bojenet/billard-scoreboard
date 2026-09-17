alter table public.players
  add column if not exists country_code text,
  add column if not exists club_name text;

alter table public.players
  drop constraint if exists players_country_code_format;

alter table public.players
  add constraint players_country_code_format
  check (country_code is null or country_code ~ '^[A-Z]{2}$');
