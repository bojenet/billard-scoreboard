-- Run in Supabase SQL Editor

create table if not exists public.calendar_planning_events (
  id text primary key,
  date date not null,
  time text not null default '',
  end_date date null,
  all_day boolean not null default false,
  title text not null,
  location text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

alter table public.calendar_planning_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_planning_events'
      and policyname = 'calendar_planning_events admin select'
  ) then
    create policy "calendar_planning_events admin select"
    on public.calendar_planning_events
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and (ur.role = 'admin' or lower(coalesce(ur.calendar_access, 'hidden')) = 'edit')
      )
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_planning_events'
      and policyname = 'calendar_planning_events admin insert'
  ) then
    create policy "calendar_planning_events admin insert"
    on public.calendar_planning_events
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and (ur.role = 'admin' or lower(coalesce(ur.calendar_access, 'hidden')) = 'edit')
      )
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_planning_events'
      and policyname = 'calendar_planning_events admin update'
  ) then
    create policy "calendar_planning_events admin update"
    on public.calendar_planning_events
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and (ur.role = 'admin' or lower(coalesce(ur.calendar_access, 'hidden')) = 'edit')
      )
    )
    with check (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and (ur.role = 'admin' or lower(coalesce(ur.calendar_access, 'hidden')) = 'edit')
      )
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_planning_events'
      and policyname = 'calendar_planning_events admin delete'
  ) then
    create policy "calendar_planning_events admin delete"
    on public.calendar_planning_events
    for delete
    to authenticated
    using (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and (ur.role = 'admin' or lower(coalesce(ur.calendar_access, 'hidden')) = 'edit')
      )
    );
  end if;
end
$$;
