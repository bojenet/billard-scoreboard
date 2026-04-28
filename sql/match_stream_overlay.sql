alter table public.matches
  add column if not exists stream_token text not null default '';

create index if not exists idx_matches_stream_token
  on public.matches(stream_token);
