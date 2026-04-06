-- Challenge user directory for registered users
-- Run after sql/user_admin_roles.sql and sql/mvp_auth_rls.sql

create or replace function public.search_challenge_users(
  search_term text default '',
  limit_count int default 12
)
returns table (
  user_id uuid,
  display_name text,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      p.id as user_id,
      coalesce(
        nullif(trim(self_player.name), ''),
        split_part(coalesce(p.email, ''), '@', 1),
        'User'
      ) as display_name,
      coalesce(p.email, '') as email
    from public.profiles p
    left join lateral (
      select pl.name
      from public.players pl
      where pl.user_id = p.id
      order by pl.id asc
      limit 1
    ) self_player on true
    where coalesce(p.email, '') <> ''
  )
  select
    b.user_id,
    b.display_name,
    b.email
  from base b
  where
    coalesce(trim(search_term), '') = ''
    or lower(b.display_name) like '%' || lower(trim(search_term)) || '%'
    or lower(b.email) like '%' || lower(trim(search_term)) || '%'
  order by lower(b.display_name), lower(b.email)
  limit greatest(1, least(coalesce(limit_count, 12), 50));
$$;

grant execute on function public.search_challenge_users(text, int) to authenticated;
