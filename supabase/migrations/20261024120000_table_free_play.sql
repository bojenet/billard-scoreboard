begin;
alter table public.tournament_operation_tables add column mode_version bigint not null default 0;
create function public.table_mode_version() returns trigger language plpgsql set search_path='' as $$
begin
 if new.event_id is distinct from old.event_id then new.mode_version:=old.mode_version+1;end if;
 return new;
end $$;
revoke all on function public.table_mode_version() from public,anon,authenticated;
create trigger table_mode_version before update of event_id on public.tournament_operation_tables for each row execute function public.table_mode_version();
create table public.table_free_games (
 table_id text primary key references public.tournament_operation_tables(id) on delete cascade,
 state jsonb not null,
 version integer not null default 0,
 history jsonb not null default '[]',
 updated_at timestamptz not null default now()
);
alter table public.table_free_games enable row level security;
revoke all on public.table_free_games from anon,authenticated;
create or replace function public.tournament_table_state(p_table text) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(t)||jsonb_build_object('live_state',coalesce(g.state,public.tournament_initial_score()),'live_version',coalesce(g.version,0),'can_undo',coalesce(jsonb_array_length(g.history)>0,false),'free_state',coalesce(f.state,public.tournament_initial_score()),'free_version',coalesce(f.version,0),'free_can_undo',coalesce(jsonb_array_length(f.history)>0,false))
 from public.tournament_operation_tables t
 left join public.tournament_live_games g on g.event_id=t.event_id and g.game_key=t.assignment->>'key'
 left join public.table_free_games f on f.table_id=t.id where t.id=p_table;
$$;
create function public.table_free_input(p_table text,p_version integer,p_mode_version bigint,p_action text,p_value integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.tournament_operation_tables%rowtype;f public.table_free_games%rowtype;s jsonb;h jsonb;side integer;points bigint;series bigint;innings bigint;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Kein Zugriff auf die Tischbedienung.';end if;
 perform pg_advisory_xact_lock(823104);
 select * into strict t from public.tournament_operation_tables where id=p_table for update;
 if t.event_id is not null then raise exception 'Der Tisch gehört jetzt zu einem Turnier. Aktuelle Partie laden.';end if;
 if t.mode_version is distinct from p_mode_version then raise exception 'VERSION_CONFLICT: Der Tischbetrieb hat gewechselt. Aktuellen Stand laden.';end if;
 insert into public.table_free_games(table_id,state) values(p_table,public.tournament_initial_score()) on conflict do nothing;
 select * into strict f from public.table_free_games where table_id=p_table for update;
 if f.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Spielstand wurde geändert. Aktuellen Stand laden.';end if;
 s:=f.state;h:=f.history;side:=(s->>'active')::integer;
 if p_action='reset' then s:=public.tournament_initial_score();h:='[]';
 elsif p_action='undo' then
  if jsonb_array_length(h)=0 then raise exception 'Keine Eingabe zum Rückgängigmachen.';end if;
  s:=h->(jsonb_array_length(h)-1);h:=h-(jsonb_array_length(h)-1);
 else
  if jsonb_array_length(h)>=50 then h:=h-0;end if;h:=h||jsonb_build_array(s);
  if p_action='points' then
   if p_value is null or p_value=0 then raise exception 'Bitte eine gültige Punktezahl eingeben.';end if;
   points:=(s->>('score'||side))::bigint+p_value;series:=(s->>('series'||side))::bigint+p_value;
   if series<0 or points<0 then raise exception 'Nur Punkte der laufenden Aufnahme können abgezogen werden. Sonst Rückgängig verwenden.';end if;
   if points>2147483647 or series>2147483647 then raise exception 'Zahl zu groß.';end if;
   s:=s||jsonb_build_object('score'||side,points,'series'||side,series);
  elsif p_action='turn' then
   innings:=(s->>('innings'||side))::bigint+1;
   if innings>2147483647 then raise exception 'Zahl zu groß.';end if;
   s:=s||jsonb_build_object('innings'||side,innings,'high'||side,greatest((s->>('high'||side))::bigint,(s->>('series'||side))::bigint),'series'||side,0,'active',3-side);
  else raise exception 'Unbekannte Eingabe.';end if;
 end if;
 update public.table_free_games set state=s,history=h,version=version+1,updated_at=now() where table_id=p_table;
 return public.tournament_table_state(p_table);
end $$;
revoke all on function public.table_free_input(text,integer,bigint,text,integer) from public,anon;
grant execute on function public.table_free_input(text,integer,bigint,text,integer) to authenticated;
commit;
