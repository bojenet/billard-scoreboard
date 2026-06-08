alter table public.user_roles
  add column if not exists match_access text not null default 'edit';

alter table public.user_roles
  drop constraint if exists user_roles_match_access_check;

alter table public.user_roles
  add constraint user_roles_match_access_check
  check (match_access in ('hidden', 'read', 'edit'));

insert into public.user_roles (
  user_id,
  role,
  match_access,
  position_library_access,
  training_access,
  tournament_access,
  calendar_access,
  stream_overlay_access
)
select id, 'member', 'edit', 'edit', 'edit', 'edit', 'edit', true
from auth.users
on conflict (user_id) do nothing;