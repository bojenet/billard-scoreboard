-- Run in Supabase SQL Editor

create table if not exists public.calendar_manual_events (
  id text primary key,
  date date not null,
  time text not null default '',
  end_date date null,
  all_day boolean not null default false,
  title text not null,
  location text not null default '',
  note text not null default '',
  discipline_id text not null default 'other',
  discipline_label text not null default 'Sonstige',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

alter table public.calendar_manual_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_manual_events'
      and policyname = 'calendar_manual_events public read'
  ) then
    create policy "calendar_manual_events public read"
    on public.calendar_manual_events
    for select
    to anon, authenticated
    using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_manual_events'
      and policyname = 'calendar_manual_events admin insert'
  ) then
    create policy "calendar_manual_events admin insert"
    on public.calendar_manual_events
    for insert
    to authenticated
    with check (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'admin'
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
      and tablename = 'calendar_manual_events'
      and policyname = 'calendar_manual_events admin update'
  ) then
    create policy "calendar_manual_events admin update"
    on public.calendar_manual_events
    for update
    to authenticated
    using (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'admin'
      )
    )
    with check (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'admin'
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
      and tablename = 'calendar_manual_events'
      and policyname = 'calendar_manual_events admin delete'
  ) then
    create policy "calendar_manual_events admin delete"
    on public.calendar_manual_events
    for delete
    to authenticated
    using (
      exists (
        select 1
        from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role = 'admin'
      )
    );
  end if;
end
$$;
