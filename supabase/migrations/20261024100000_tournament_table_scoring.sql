begin;
create table public.tournament_live_games (
 event_id uuid not null references public.result_events(id) on delete cascade,
 game_key text not null,
 state jsonb not null,
 version integer not null default 0,
 history jsonb not null default '[]',
 updated_at timestamptz not null default now(),
 primary key(event_id,game_key)
);
alter table public.tournament_live_games enable row level security;
revoke all on public.tournament_live_games from anon,authenticated;
create function public.protect_started_live_tournament() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (new.snapshot-'tableIds') is distinct from (old.snapshot-'tableIds') and exists(select 1 from public.tournament_live_games where event_id=old.id and version>0) then
  raise exception 'Die Punkteerfassung hat bereits begonnen. Teilnehmer, Modus und Spielziel dürfen nicht mehr geändert werden.';
 end if;
 return new;
end $$;
revoke all on function public.protect_started_live_tournament() from public,anon,authenticated;
create trigger protect_started_live_tournament before update of snapshot on public.result_events for each row execute function public.protect_started_live_tournament();
create function public.tournament_initial_score() returns jsonb language sql immutable set search_path='' as $$
 select '{"score1":0,"score2":0,"innings1":0,"innings2":0,"high1":0,"high2":0,"series1":0,"series2":0,"active":1,"done":false}'::jsonb;
$$;
create function public.tournament_table_state(p_table text) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(t)||jsonb_build_object('live_state',coalesce(g.state,public.tournament_initial_score()),'live_version',coalesce(g.version,0),'can_undo',coalesce(jsonb_array_length(g.history)>0,false))
 from public.tournament_operation_tables t left join public.tournament_live_games g on g.event_id=t.event_id and g.game_key=t.assignment->>'key' where t.id=p_table;
$$;
revoke all on function public.tournament_initial_score(),public.tournament_table_state(text) from public,anon,authenticated;
create function public.tournament_table_input(p_table text,p_event uuid,p_key text,p_version integer,p_action text,p_value integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;t public.tournament_operation_tables%rowtype;l public.tournament_live_games%rowtype;s jsonb;before_score jsonb;h jsonb;g jsonb;side integer;points integer;series integer;innings integer;target integer;max_innings integer;new_version integer;r jsonb;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Nur freigeschaltete Turniertische dürfen zählen.';end if;
 perform pg_advisory_xact_lock(823104);
 select * into strict e from public.result_events where id=p_event for update;
 select * into strict t from public.tournament_operation_tables where id=p_table for update;
 if t.event_id is distinct from p_event or t.assignment->>'key' is distinct from p_key then raise exception 'Die Tischzuordnung hat sich geändert. Bitte den aktuellen Stand laden.';end if;
 if t.paused then raise exception 'Das Turnier ist pausiert.';end if;
 if e.status<>'open' then raise exception 'Das Turnier ist abgeschlossen.';end if;
 if e.results ? p_key then raise exception 'Ergebnis bereits gespeichert. Korrekturen erfolgen in der manuellen Ergebniserfassung.';end if;
 select value into g from jsonb_array_elements(public.result_schedule(e.snapshot,e.results,e.group_order)) where value->>'key'=p_key;
 if g is null or not (g->>'ready')::boolean or g->>'seed1' is distinct from t.assignment->>'seed1' or g->>'seed2' is distinct from t.assignment->>'seed2' then raise exception 'Die Paarung hat sich geändert. Die Turnierleitung muss die Tischzuordnung prüfen.';end if;
 insert into public.tournament_live_games(event_id,game_key,state) values(p_event,p_key,public.tournament_initial_score()) on conflict do nothing;
 select * into strict l from public.tournament_live_games where event_id=p_event and game_key=p_key for update;
 if l.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Spielstand wurde geändert. Aktuellen Stand laden; Eingabe nicht erneut automatisch senden.';end if;
 s:=l.state;before_score:=s;h:=l.history;side:=(s->>'active')::integer;
 target:=(e.snapshot->>'playingTargetPoints')::integer;max_innings:=(e.snapshot->>'playingTargetInnings')::integer;
 if p_action='undo' then
  if jsonb_array_length(h)=0 then raise exception 'Keine Eingabe zum Rückgängigmachen.';end if;
  s:=h->(jsonb_array_length(h)-1);h:=h-(jsonb_array_length(h)-1);
 elsif p_action='finish' then
  if not (s->>'done')::boolean then raise exception 'Zuerst die Partie einschließlich Nachstoß und Aufnahmen beenden.';end if;
  r:=jsonb_build_object('score1',s->'score1','score2',s->'score2','innings1',s->'innings1','innings2',s->'innings2','high1',s->'high1','high2',s->'high2');
  if g->>'stage'='final' and s->>'score1'=s->>'score2' then
   if p_value not in (1,2) or p_value is null then raise exception 'Bei Gleichstand den Sieger nach Entscheid auswählen.';end if;
   r:=r||jsonb_build_object('winner',p_value);
  end if;
  new_version:=public.save_t15_result(p_event,p_key,r,e.version,false);
  s:=s||'{"saved":true}'::jsonb;h:='[]';
 else
  if (s->>'done')::boolean then raise exception 'Partie beendet. Ergebnis speichern oder mit Rückgängig korrigieren.';end if;
  if p_action='points' then
   if p_value is null or p_value=0 or p_value not between -1000000 and 1000000 then raise exception 'Bitte eine gültige Punktezahl eingeben.';end if;
   points:=(s->>('score'||side))::integer+p_value;series:=(s->>('series'||side))::integer+p_value;
   if series<0 or points<0 then raise exception 'Nur Punkte der laufenden Aufnahme können abgezogen werden. Sonst Rückgängig verwenden.';end if;
   if points>target then raise exception 'Das Spielziel beträgt % Punkte.',target;end if;
   s:=s||jsonb_build_object('score'||side,points,'series'||side,series);
  elsif p_action='turn' then
   innings:=(s->>('innings'||side))::integer+1;
   if innings>max_innings then raise exception 'Maximale Aufnahmen erreicht.';end if;
   s:=s||jsonb_build_object('innings'||side,innings,'high'||side,greatest((s->>('high'||side))::integer,(s->>('series'||side))::integer),'series'||side,0,'active',3-side);
   if side=2 and ((s->>'score1')::integer>=target or (s->>'score2')::integer>=target or innings>=max_innings) then s:=s||'{"done":true}'::jsonb;end if;
  else raise exception 'Unbekannte Eingabe.';end if;
  if jsonb_array_length(h)>=50 then h:=h-0;end if;h:=h||jsonb_build_array(before_score);
 end if;
 update public.tournament_live_games set state=s,history=h,version=version+1,updated_at=now() where event_id=p_event and game_key=p_key;
 return public.tournament_table_state(p_table);
end $$;
revoke all on function public.tournament_table_input(text,uuid,text,integer,text,integer) from public,anon;
grant execute on function public.tournament_table_input(text,uuid,text,integer,text,integer) to authenticated;

create or replace function public.tournament_operation(p_action text,p_table text default null,p_event uuid default null,p_tables text[] default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; t text; g jsonb; used integer[]:='{}'; chosen jsonb:='[]'; v_assignment jsonb;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Nur Administratoren haben Zugriff auf den Tischbetrieb.';end if;
 if p_action='heartbeat' then
  update public.tournament_operation_tables set last_seen=now() where id=p_table;
  if not found then raise exception 'Unbekannter Tisch.';end if;
  return public.tournament_table_state(p_table);
 end if;
 if p_action not in ('state','start','pause','resume','stop') then raise exception 'Unbekannte Aktion.';end if;
 if p_action<>'state' then
  perform pg_advisory_xact_lock(823104);
  if p_event is null then raise exception 'Bitte ein Turnier wählen.';end if;
  select * into strict e from public.result_events where id=p_event for update;
  if p_action='start' then
   if e.status<>'open' then raise exception 'Das Turnier ist abgeschlossen.';end if;
   select array_agg(value order by ord) into p_tables from jsonb_array_elements_text(coalesce(e.snapshot->'tableIds','[]')) with ordinality as x(value,ord);
   if coalesce(cardinality(p_tables),0)=0 or cardinality(p_tables)>6 then raise exception 'Keine Tische im Turnier gespeichert. Bitte in der Einladung festlegen und Turnierdaten aktualisieren.';end if;
   if (select count(distinct x) from unnest(p_tables) x)<>cardinality(p_tables) then raise exception 'Tisch mehrfach gewählt.';end if;
   if exists(select 1 from public.tournament_operation_tables where event_id=p_event) then raise exception 'Das Turnier ist bereits gestartet.';end if;
   foreach t in array p_tables loop
    if not exists(select 1 from public.tournament_operation_tables where id=t and last_seen>now()-interval '30 seconds' and event_id is null) then raise exception 'Tisch % ist offline oder belegt.',t;end if;
   end loop;
   foreach t in array p_tables loop
    v_assignment:=null;
    for g in select value from jsonb_array_elements(public.result_schedule(e.snapshot,e.results,e.group_order)) loop
     if (g->>'ready')::boolean and not(e.results ? (g->>'key')) and not ((g->>'seed1')::integer=any(used)) and not ((g->>'seed2')::integer=any(used)) then
      v_assignment:=g||jsonb_build_object('title',e.title,'snapshot',e.snapshot);
      used:=used||array[(g->>'seed1')::integer,(g->>'seed2')::integer];exit;
     end if;
    end loop;
    update public.tournament_operation_tables set event_id=p_event,assignment=v_assignment,paused=false where id=t;
    if v_assignment is not null then chosen:=chosen||jsonb_build_array(v_assignment);end if;
   end loop;
   if jsonb_array_length(chosen)=0 then raise exception 'Keine spielbereiten Partien vorhanden.';end if;
  elsif p_action='stop' then
   update public.tournament_operation_tables set event_id=null,assignment=null,paused=false where event_id=p_event;
  else
   update public.tournament_operation_tables set paused=(p_action='pause') where event_id=p_event;
  end if;
 end if;
 return jsonb_build_object('tables',(select jsonb_agg(public.tournament_table_state(id) order by id) from public.tournament_operation_tables x),'events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'tableIds',coalesce(snapshot->'tableIds','[]')) order by event_date desc),'[]') from public.result_events));
end $$;


commit;
