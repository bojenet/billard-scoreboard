alter table public.matches
  add column if not exists series_log1 jsonb not null default '[]'::jsonb,
  add column if not exists series_log2 jsonb not null default '[]'::jsonb;
