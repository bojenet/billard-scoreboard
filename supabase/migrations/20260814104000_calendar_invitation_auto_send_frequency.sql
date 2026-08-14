alter table public.calendar_settings
  add column if not exists invitation_auto_send_frequency text not null default 'daily';

alter table public.calendar_settings
  drop constraint if exists calendar_settings_invitation_auto_send_frequency_check;

alter table public.calendar_settings
  add constraint calendar_settings_invitation_auto_send_frequency_check
  check (invitation_auto_send_frequency in ('daily', 'hourly', 'every_15_minutes'));
