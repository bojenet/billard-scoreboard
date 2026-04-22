create table if not exists public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

create or replace function public.app_settings_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_settings_touch_updated_at on public.app_settings;
create trigger trg_app_settings_touch_updated_at
before update on public.app_settings
for each row execute function public.app_settings_touch_updated_at();

insert into public.app_settings (key, value)
values ('position_library_access', 'edit')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select_authenticated" on public.app_settings;
create policy "app_settings_select_authenticated"
  on public.app_settings
  for select
  to authenticated
  using (true);

drop policy if exists "app_settings_admin_insert" on public.app_settings;
create policy "app_settings_admin_insert"
  on public.app_settings
  for insert
  to authenticated
  with check (public.is_admin(auth.uid()));

drop policy if exists "app_settings_admin_update" on public.app_settings;
create policy "app_settings_admin_update"
  on public.app_settings
  for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "app_settings_admin_delete" on public.app_settings;
create policy "app_settings_admin_delete"
  on public.app_settings
  for delete
  to authenticated
  using (public.is_admin(auth.uid()));

