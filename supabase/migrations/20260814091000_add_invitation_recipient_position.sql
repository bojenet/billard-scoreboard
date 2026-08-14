alter table public.calendar_invitation_recipients
  add column if not exists position text not null default '';
