alter table public.calendar_settings
  add column if not exists invitation_auto_send_time text not null default '08:00';

alter table public.calendar_settings
  drop constraint if exists calendar_settings_invitation_auto_send_time_check;

alter table public.calendar_settings
  add constraint calendar_settings_invitation_auto_send_time_check
  check (invitation_auto_send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
