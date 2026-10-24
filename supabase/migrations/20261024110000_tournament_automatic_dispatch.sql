begin;
alter table public.tournament_operation_tables add column completion jsonb;
create function public.tournament_clear_completion() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.tournament_operation_tables set completion=null where completion->>'event_id'=old.id::text;
 return old;
end $$;
revoke all on function public.tournament_clear_completion() from public,anon,authenticated;
create trigger tournament_clear_completion after delete on public.result_events for each row execute function public.tournament_clear_completion();

-- Internal helpers are never exposed as client RPCs.
create function public.tournament_save_ready(p_table text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.tournament_operation_tables%rowtype;e public.result_events%rowtype;l public.tournament_live_games%rowtype;g jsonb;r jsonb;v integer;
begin
 perform pg_advisory_xact_lock(823104);
 select * into t from public.tournament_operation_tables where id=p_table;
 if t.event_id is null or t.assignment is null or t.paused then return;end if;
 select * into strict e from public.result_events where id=t.event_id for update;
 if e.status<>'open' or e.results ? (t.assignment->>'key') then return;end if;
 select * into l from public.tournament_live_games where event_id=e.id and game_key=t.assignment->>'key' for update;
 if not found or not coalesce((l.state->>'done')::boolean,false) or coalesce((l.state->>'saved')::boolean,false) then return;end if;
 select value into g from jsonb_array_elements(public.result_schedule(e.snapshot,e.results,e.group_order)) where value->>'key'=t.assignment->>'key';
 if g is null or not (g->>'ready')::boolean or g->>'seed1' is distinct from t.assignment->>'seed1' or g->>'seed2' is distinct from t.assignment->>'seed2' then return;end if;
 -- A drawn knockout game needs a human decision; never invent a winner.
 if g->>'stage'='final' and l.state->>'score1'=l.state->>'score2' then return;end if;
 r:=jsonb_build_object('score1',l.state->'score1','score2',l.state->'score2','innings1',l.state->'innings1','innings2',l.state->'innings2','high1',l.state->'high1','high2',l.state->'high2');
 v:=public.save_t15_result(e.id,t.assignment->>'key',r,e.version,false);
 update public.tournament_live_games set state=state||'{"saved":true}'::jsonb,history='[]',version=version+1,updated_at=now() where event_id=e.id and game_key=t.assignment->>'key';
end $$;

create function public.tournament_dispatch_event(p_event uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;t public.tournament_operation_tables%rowtype;g jsonb;plan jsonb;used integer[]:='{}';assigned text[]:='{}';next_game jsonb;
begin
 if p_event is null then return;end if;
 perform pg_advisory_xact_lock(823104);
 select * into e from public.result_events where id=p_event for update;
 if not found or not exists(select 1 from public.tournament_operation_tables where event_id=p_event) then return;end if;
 if e.status='completed' then
  update public.tournament_operation_tables set event_id=null,assignment=null,paused=false,completion=jsonb_build_object('event_id',e.id,'title',e.title,'ended_at',now()) where event_id=e.id;
  return;
 end if;
 if exists(select 1 from public.tournament_operation_tables where event_id=p_event and paused) then return;end if;
 -- Recover already-finished games, including displays opened before this deployment.
 for t in select * from public.tournament_operation_tables where event_id=p_event order by id loop
  perform public.tournament_save_ready(t.id);
 end loop;
 select * into strict e from public.result_events where id=p_event;
 plan:=public.result_schedule(e.snapshot,e.results,e.group_order);
 update public.tournament_operation_tables set assignment=null where event_id=p_event and e.results ? (assignment->>'key');
 if jsonb_array_length(plan)>0 and not exists(select 1 from jsonb_array_elements(plan) x where not coalesce((x->>'ready')::boolean,false) or not(e.results ? (x->>'key'))) then
  update public.result_events set status='completed',version=version+1,updated_at=now() where id=p_event;
  insert into public.result_event_history(event_id,actor_id,action,before_state,after_state) values(e.id,auth.uid(),'Turnier automatisch abgeschlossen',jsonb_build_object('status',e.status,'version',e.version),jsonb_build_object('status','completed','version',e.version+1));
  update public.tournament_operation_tables set event_id=null,assignment=null,paused=false,completion=jsonb_build_object('event_id',e.id,'title',e.title,'ended_at',now()) where event_id=e.id;
  return;
 end if;
 -- Reserve players even at temporarily offline tables. Never steal a running game.
 for t in select * from public.tournament_operation_tables where event_id=p_event and assignment is not null order by id loop
  used:=used||array[(t.assignment->>'seed1')::integer,(t.assignment->>'seed2')::integer];
  assigned:=array_append(assigned,t.assignment->>'key');
 end loop;
 for t in select * from public.tournament_operation_tables where event_id=p_event and assignment is null and last_seen>now()-interval '30 seconds' order by id loop
  next_game:=null;
  for g in select value from jsonb_array_elements(plan) loop
   if coalesce((g->>'ready')::boolean,false) and not(e.results ? (g->>'key')) and not((g->>'key')=any(assigned)) and not((g->>'seed1')::integer=any(used)) and not((g->>'seed2')::integer=any(used)) then next_game:=g;exit;end if;
  end loop;
  if next_game is not null then
   update public.tournament_operation_tables set assignment=next_game||jsonb_build_object('title',e.title,'snapshot',e.snapshot),completion=null where id=t.id;
   assigned:=array_append(assigned,next_game->>'key');
   used:=used||array[(next_game->>'seed1')::integer,(next_game->>'seed2')::integer];
  end if;
 end loop;
end $$;
revoke all on function public.tournament_save_ready(text),public.tournament_dispatch_event(uuid) from public,anon,authenticated;

create or replace function public.tournament_table_input(p_table text,p_event uuid,p_key text,p_version integer,p_action text,p_value integer default 0) returns jsonb
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
 if p_action in ('turn','finish') then perform public.tournament_dispatch_event(p_event);end if;
 return public.tournament_table_state(p_table);
end $$;

create or replace function public.tournament_operation(p_action text,p_table text default null,p_event uuid default null,p_tables text[] default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; t text; g jsonb; used integer[]:='{}'; chosen jsonb:='[]'; v_assignment jsonb;dispatch_id uuid;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Nur Administratoren haben Zugriff auf den Tischbetrieb.';end if;
 perform pg_advisory_xact_lock(823104);
 if p_action='heartbeat' then
  select event_id into dispatch_id from public.tournament_operation_tables where id=p_table;
  if dispatch_id is not null then perform 1 from public.result_events where id=dispatch_id for update;end if;
  update public.tournament_operation_tables set last_seen=now() where id=p_table;
  if not found then raise exception 'Unbekannter Tisch.';end if;
  perform public.tournament_dispatch_event(dispatch_id);
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
    update public.tournament_operation_tables set event_id=p_event,assignment=v_assignment,paused=false,completion=null where id=t;
    if v_assignment is not null then chosen:=chosen||jsonb_build_array(v_assignment);end if;
   end loop;
   if jsonb_array_length(chosen)=0 then raise exception 'Keine spielbereiten Partien vorhanden.';end if;
  elsif p_action='stop' then
   update public.tournament_operation_tables set event_id=null,assignment=null,paused=false where event_id=p_event;
  else
   update public.tournament_operation_tables set paused=(p_action='pause') where event_id=p_event;
  end if;
 end if;
 if p_action='state' then
  for dispatch_id in select distinct event_id from public.tournament_operation_tables where event_id is not null loop perform public.tournament_dispatch_event(dispatch_id);end loop;
 elsif p_action in ('start','resume') then perform public.tournament_dispatch_event(p_event);end if;
 return jsonb_build_object('tables',(select jsonb_agg(public.tournament_table_state(id) order by id) from public.tournament_operation_tables x),'events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'tableIds',coalesce(snapshot->'tableIds','[]')) order by event_date desc),'[]') from public.result_events));
end $$;



commit;
