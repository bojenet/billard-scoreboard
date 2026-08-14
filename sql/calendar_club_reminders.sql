-- Run in Supabase SQL Editor

create table if not exists public.calendar_club_reminders (
  id text primary key,
  event_id text not null,
  event_date date not null,
  reminder_date date not null,
  days_before integer not null,
  title text not null,
  location text not null default '',
  link text not null default '',
  message_text text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz null,
  sent_by uuid null references auth.users(id) on delete set null,
  sent_by_name text not null default ''
);

create table if not exists public.calendar_invitation_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  email text not null,
  recipient_group text not null default 'clubs',
  delivery_type text not null default 'bcc',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_invitation_email_logs (
  id uuid primary key default gen_random_uuid(),
  reminder_id text not null references public.calendar_club_reminders(id) on delete cascade,
  event_id text not null default '',
  subject text not null default '',
  recipient_count integer not null default 0,
  status text not null default 'pending',
  error_message text not null default '',
  message_id text not null default '',
  sent_at timestamptz not null default now()
);

alter table public.calendar_club_reminders
  add column if not exists event_id text not null default '';

alter table public.calendar_club_reminders
  add column if not exists event_date date;

alter table public.calendar_club_reminders
  add column if not exists reminder_date date;

alter table public.calendar_club_reminders
  add column if not exists days_before integer not null default 14;

alter table public.calendar_club_reminders
  add column if not exists title text not null default '';

alter table public.calendar_club_reminders
  add column if not exists location text not null default '';

alter table public.calendar_club_reminders
  add column if not exists link text not null default '';

alter table public.calendar_club_reminders
  add column if not exists message_text text not null default '';

alter table public.calendar_club_reminders
  add column if not exists status text not null default 'open';

alter table public.calendar_club_reminders
  add column if not exists created_at timestamptz not null default now();

alter table public.calendar_club_reminders
  add column if not exists updated_at timestamptz not null default now();

alter table public.calendar_club_reminders
  add column if not exists sent_at timestamptz null;

alter table public.calendar_club_reminders
  add column if not exists sent_by uuid null references auth.users(id) on delete set null;

alter table public.calendar_club_reminders
  add column if not exists sent_by_name text not null default '';

alter table public.calendar_club_reminders
  drop constraint if exists calendar_club_reminders_status_check;

alter table public.calendar_club_reminders
  add constraint calendar_club_reminders_status_check
  check (status in ('open', 'sent', 'skipped'));

create index if not exists idx_calendar_club_reminders_status_date
  on public.calendar_club_reminders (status, reminder_date);

create index if not exists idx_calendar_club_reminders_event_date
  on public.calendar_club_reminders (event_date);

create unique index if not exists idx_calendar_invitation_recipients_email_group
  on public.calendar_invitation_recipients (email, recipient_group);

create index if not exists idx_calendar_invitation_recipients_active
  on public.calendar_invitation_recipients (active, recipient_group);

alter table public.calendar_invitation_recipients
  add column if not exists delivery_type text not null default 'bcc';

alter table public.calendar_invitation_recipients
  drop constraint if exists calendar_invitation_recipients_delivery_type_check;

alter table public.calendar_invitation_recipients
  add constraint calendar_invitation_recipients_delivery_type_check
  check (delivery_type in ('to', 'cc', 'bcc'));

create index if not exists idx_calendar_invitation_email_logs_reminder
  on public.calendar_invitation_email_logs (reminder_id, status);

alter table public.calendar_club_reminders enable row level security;
alter table public.calendar_invitation_recipients enable row level security;
alter table public.calendar_invitation_email_logs enable row level security;

drop policy if exists "calendar_club_reminders admin select" on public.calendar_club_reminders;
create policy "calendar_club_reminders admin select"
on public.calendar_club_reminders
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

drop policy if exists "calendar_club_reminders admin insert" on public.calendar_club_reminders;
create policy "calendar_club_reminders admin insert"
on public.calendar_club_reminders
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

drop policy if exists "calendar_club_reminders admin update" on public.calendar_club_reminders;
create policy "calendar_club_reminders admin update"
on public.calendar_club_reminders
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

drop policy if exists "calendar_invitation_recipients admin select" on public.calendar_invitation_recipients;
create policy "calendar_invitation_recipients admin select"
on public.calendar_invitation_recipients
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

drop policy if exists "calendar_invitation_recipients admin insert" on public.calendar_invitation_recipients;
create policy "calendar_invitation_recipients admin insert"
on public.calendar_invitation_recipients
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

drop policy if exists "calendar_invitation_recipients admin update" on public.calendar_invitation_recipients;
create policy "calendar_invitation_recipients admin update"
on public.calendar_invitation_recipients
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

drop policy if exists "calendar_invitation_email_logs admin select" on public.calendar_invitation_email_logs;
create policy "calendar_invitation_email_logs admin select"
on public.calendar_invitation_email_logs
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
