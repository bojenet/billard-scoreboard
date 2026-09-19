alter table public.matches
  add column if not exists undo_state jsonb;
