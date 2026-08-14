alter table public.calendar_settings
  add column if not exists invitation_auto_send_enabled boolean not null default false;

alter table public.calendar_settings
  add column if not exists invitation_auto_send_days_before integer not null default 14;

alter table public.calendar_settings
  add column if not exists invitation_auto_send_limit integer not null default 10;

alter table public.calendar_settings
  drop constraint if exists calendar_settings_invitation_auto_send_days_check;

alter table public.calendar_settings
  add constraint calendar_settings_invitation_auto_send_days_check
  check (invitation_auto_send_days_before between 0 and 365);

alter table public.calendar_settings
  drop constraint if exists calendar_settings_invitation_auto_send_limit_check;

alter table public.calendar_settings
  add constraint calendar_settings_invitation_auto_send_limit_check
  check (invitation_auto_send_limit between 1 and 25);
