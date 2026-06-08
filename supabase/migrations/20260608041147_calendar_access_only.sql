alter table public.user_roles
  add column if not exists calendar_access text not null default 'edit';

alter table public.user_roles
  drop constraint if exists user_roles_calendar_access_check;

alter table public.user_roles
  add constraint user_roles_calendar_access_check
  check (calendar_access in ('hidden', 'read', 'edit'));