alter table public.user_roles
  add column if not exists club_mobile_access text not null default 'hidden';

alter table public.user_roles
  drop constraint if exists user_roles_club_mobile_access_check;

alter table public.user_roles
  add constraint user_roles_club_mobile_access_check
  check (club_mobile_access in ('hidden', 'edit'));
