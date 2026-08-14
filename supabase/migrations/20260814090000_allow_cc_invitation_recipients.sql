alter table public.calendar_invitation_recipients
  drop constraint if exists calendar_invitation_recipients_delivery_type_check;

alter table public.calendar_invitation_recipients
  add constraint calendar_invitation_recipients_delivery_type_check
  check (delivery_type in ('to', 'cc', 'bcc'));
