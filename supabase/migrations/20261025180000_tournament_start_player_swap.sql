begin;
create function public.tournament_ordered_result(p_result jsonb,p_state jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb:=p_result;k text;
begin
 if coalesce((p_state->>'swapped')::boolean,false) then
  foreach k in array array['score','innings','high'] loop r:=r||jsonb_build_object(k||'1',p_result->(k||'2'),k||'2',p_result->(k||'1'));end loop;
  if p_result ? 'winner' then r:=r||jsonb_build_object('winner',3-(p_result->>'winner')::integer);end if;
 end if;
 return r;
end $$;
revoke all on function public.tournament_ordered_result(jsonb,jsonb) from public,anon,authenticated;
create or replace function public.tournament_save_ready(p_table text) returns void
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
 r:=public.tournament_ordered_result(r,l.state);
 v:=public.save_t15_result(e.id,t.assignment->>'key',r,e.version,false);
 update public.tournament_live_games set state=state||'{"saved":true}'::jsonb,history='[]',version=version+1,updated_at=now() where event_id=e.id and game_key=t.assignment->>'key';
end $$;

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
 if p_action='swap' then
  if coalesce((s->>'started')::boolean,false) or (s->>'score1')::integer<>0 or (s->>'score2')::integer<>0 or (s->>'innings1')::integer<>0 or (s->>'innings2')::integer<>0 then raise exception 'Spieler können nur vor der ersten Eingabe gewechselt werden.';end if;
  s:=s||jsonb_build_object('swapped',not coalesce((s->>'swapped')::boolean,false));
 elsif p_action='undo' then
  if jsonb_array_length(h)=0 then raise exception 'Keine Eingabe zum Rückgängigmachen.';end if;
  s:=h->(jsonb_array_length(h)-1);h:=h-(jsonb_array_length(h)-1);
 elsif p_action='finish' then
  if not (s->>'done')::boolean then raise exception 'Zuerst die Partie einschließlich Nachstoß und Aufnahmen beenden.';end if;
  r:=jsonb_build_object('score1',s->'score1','score2',s->'score2','innings1',s->'innings1','innings2',s->'innings2','high1',s->'high1','high2',s->'high2');
  if g->>'stage'='final' and s->>'score1'=s->>'score2' then
   if p_value not in (1,2) or p_value is null then raise exception 'Bei Gleichstand den Sieger nach Entscheid auswählen.';end if;
   r:=r||jsonb_build_object('winner',p_value);
  end if;
  r:=public.tournament_ordered_result(r,s);
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
  s:=s||'{"started":true}'::jsonb;
  if jsonb_array_length(h)>=50 then h:=h-0;end if;h:=h||jsonb_build_array(before_score);
 end if;
 update public.tournament_live_games set state=s,history=h,version=version+1,updated_at=now() where event_id=p_event and game_key=p_key;
 if p_action in ('turn','finish') then perform public.tournament_dispatch_event(p_event);end if;
 return public.tournament_table_state(p_table);
end $$;

commit;
