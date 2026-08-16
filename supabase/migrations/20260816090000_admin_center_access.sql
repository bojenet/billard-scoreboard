alter table public.user_roles
  add column if not exists admin_center_access boolean not null default false;

create or replace function public.has_admin_center_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = uid
      and (
        ur.role = 'admin'
        or coalesce(ur.admin_center_access, false) = true
      )
  );
$$;

grant execute on function public.has_admin_center_access(uuid) to authenticated;

drop policy if exists "calendar_settings admin insert" on public.calendar_settings;
create policy "calendar_settings admin insert"
on public.calendar_settings
for insert
to authenticated
with check (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_settings admin update" on public.calendar_settings;
create policy "calendar_settings admin update"
on public.calendar_settings
for update
to authenticated
using (public.has_admin_center_access(auth.uid()))
with check (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_invitation_recipients admin select" on public.calendar_invitation_recipients;
create policy "calendar_invitation_recipients admin select"
on public.calendar_invitation_recipients
for select
to authenticated
using (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_invitation_recipients admin insert" on public.calendar_invitation_recipients;
create policy "calendar_invitation_recipients admin insert"
on public.calendar_invitation_recipients
for insert
to authenticated
with check (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_invitation_recipients admin update" on public.calendar_invitation_recipients;
create policy "calendar_invitation_recipients admin update"
on public.calendar_invitation_recipients
for update
to authenticated
using (public.has_admin_center_access(auth.uid()))
with check (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_invitation_email_logs admin select" on public.calendar_invitation_email_logs;
create policy "calendar_invitation_email_logs admin select"
on public.calendar_invitation_email_logs
for select
to authenticated
using (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_manual_events admin center insert" on public.calendar_manual_events;
create policy "calendar_manual_events admin center insert"
on public.calendar_manual_events
for insert
to authenticated
with check (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_manual_events admin center update" on public.calendar_manual_events;
create policy "calendar_manual_events admin center update"
on public.calendar_manual_events
for update
to authenticated
using (public.has_admin_center_access(auth.uid()))
with check (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_planning_events admin center select" on public.calendar_planning_events;
create policy "calendar_planning_events admin center select"
on public.calendar_planning_events
for select
to authenticated
using (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_planning_events admin center insert" on public.calendar_planning_events;
create policy "calendar_planning_events admin center insert"
on public.calendar_planning_events
for insert
to authenticated
with check (public.has_admin_center_access(auth.uid()));

drop policy if exists "calendar_planning_events admin center update" on public.calendar_planning_events;
create policy "calendar_planning_events admin center update"
on public.calendar_planning_events
for update
to authenticated
using (public.has_admin_center_access(auth.uid()))
with check (public.has_admin_center_access(auth.uid()));
