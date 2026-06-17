alter table public.matches
  add column if not exists shot_clock_running boolean not null default false,
  add column if not exists shot_clock_started_at timestamptz,
  add column if not exists shot_clock_remaining_seconds integer not null default 40,
  add column if not exists shot_clock_timeouts1 integer not null default 0,
  add column if not exists shot_clock_timeouts2 integer not null default 0;
