alter table public.matches
  add column if not exists display_table text not null default '';
