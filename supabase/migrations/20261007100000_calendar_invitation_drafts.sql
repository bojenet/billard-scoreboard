create table public.calendar_invitation_drafts (
  source_url text primary key,
  invitation jsonb not null check (jsonb_typeof(invitation) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.calendar_invitation_drafts enable row level security;

grant select, insert, update on public.calendar_invitation_drafts to authenticated;

create policy "calendar editors read invitation drafts"
on public.calendar_invitation_drafts for select to authenticated
using (public.has_calendar_admin_access(auth.uid()));

create policy "calendar editors insert invitation drafts"
on public.calendar_invitation_drafts for insert to authenticated
with check (public.has_calendar_admin_access(auth.uid()));

create policy "calendar editors update invitation drafts"
on public.calendar_invitation_drafts for update to authenticated
using (public.has_calendar_admin_access(auth.uid()))
with check (public.has_calendar_admin_access(auth.uid()));
