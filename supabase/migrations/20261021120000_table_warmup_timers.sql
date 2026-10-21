create table public.table_warmup_timers (
 table_id text primary key check(table_id in('tisch1','tisch2')),
 duration_seconds integer not null default 300 check(duration_seconds in(300,600)),
 remaining_seconds integer not null default 300 check(remaining_seconds between 0 and 600),
 started_at timestamptz,
 running boolean not null default false,
 active boolean not null default false,
 revision integer not null default 1
);
insert into public.table_warmup_timers(table_id) values('tisch1'),('tisch2');
alter table public.table_warmup_timers enable row level security;
revoke all on public.table_warmup_timers from anon,authenticated;
grant select on public.table_warmup_timers to anon,authenticated;
grant all on public.table_warmup_timers to service_role;
create policy warmup_display_read on public.table_warmup_timers for select to anon,authenticated using(true);

create function public.control_table_warmup(p_table text,p_action text,p_revision integer,p_duration integer default null)
returns public.table_warmup_timers language plpgsql security definer set search_path='' as $$
declare timer public.table_warmup_timers%rowtype; remaining integer;
begin
 if auth.uid() is null or not (public.is_admin(auth.uid()) or exists(select 1 from public.user_roles where user_id=auth.uid() and club_mobile_access='edit')) then raise exception 'Keine Berechtigung zur Tischsteuerung.';end if;
 select * into strict timer from public.table_warmup_timers where table_id=p_table for update;
 if timer.revision is distinct from p_revision then raise exception 'VERSION_CONFLICT: Der Einspiel-Timer wurde an anderer Stelle geändert. Bitte erneut versuchen.';end if;
 remaining:=timer.remaining_seconds;
 if timer.running and timer.started_at is not null then remaining:=greatest(0,ceil(timer.remaining_seconds-extract(epoch from (clock_timestamp()-timer.started_at)))::integer);end if;
 if p_action='duration' then
  if p_duration is null or p_duration not in(300,600) then raise exception 'Bitte 5 oder 10 Minuten auswählen.';end if;
  timer.duration_seconds:=p_duration;timer.remaining_seconds:=p_duration;timer.active:=false;timer.running:=false;timer.started_at:=null;
 elsif p_action='start' then
  if exists(select 1 from public.matches where display_table=p_table and status=1 and finished=false) then raise exception 'An diesem Tisch läuft noch eine Partie. Bitte diese zuerst beenden.';end if;
  timer.remaining_seconds:=case when remaining>0 then remaining else timer.duration_seconds end;
  timer.running:=true;timer.active:=true;timer.started_at:=date_trunc('milliseconds',clock_timestamp());
 elsif p_action='pause' then
  timer.remaining_seconds:=remaining;timer.running:=false;timer.started_at:=null;
 elsif p_action in('reset','stop') then
  timer.remaining_seconds:=timer.duration_seconds;timer.running:=false;timer.active:=false;timer.started_at:=null;
 else raise exception 'Unbekannte Timer-Aktion.';end if;
 update public.table_warmup_timers set duration_seconds=timer.duration_seconds,remaining_seconds=timer.remaining_seconds,started_at=timer.started_at,running=timer.running,active=timer.active,revision=revision+1 where table_id=p_table returning * into timer;
 return timer;
end $$;
revoke all on function public.control_table_warmup(text,text,integer,integer) from public,anon;
grant execute on function public.control_table_warmup(text,text,integer,integer) to authenticated;

create function public.stop_warmup_on_match_start() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.display_table in('tisch1','tisch2') and new.status=1 and new.finished=false then
  update public.table_warmup_timers set active=false,running=false,started_at=null,remaining_seconds=duration_seconds,revision=revision+1 where table_id=new.display_table and (active or running);
 end if;
 return new;
end $$;
revoke all on function public.stop_warmup_on_match_start() from public,anon,authenticated;
create trigger stop_table_warmup_on_match_start after insert or update of display_table,status,finished on public.matches for each row execute function public.stop_warmup_on_match_start();
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='table_warmup_timers') then
  alter publication supabase_realtime add table public.table_warmup_timers;
 end if;
end $$;
