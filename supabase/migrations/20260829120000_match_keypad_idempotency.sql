alter table public.matches
  add column if not exists last_keypad_request_id text;
