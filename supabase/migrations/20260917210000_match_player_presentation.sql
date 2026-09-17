alter table public.matches
  add column if not exists player1_country_code text,
  add column if not exists player2_country_code text,
  add column if not exists player1_club_name text,
  add column if not exists player2_club_name text;

alter table public.matches
  drop constraint if exists matches_player1_country_code_format,
  drop constraint if exists matches_player2_country_code_format;

alter table public.matches
  add constraint matches_player1_country_code_format
  check (player1_country_code is null or player1_country_code ~ '^[A-Z]{2}$'),
  add constraint matches_player2_country_code_format
  check (player2_country_code is null or player2_country_code ~ '^[A-Z]{2}$');
