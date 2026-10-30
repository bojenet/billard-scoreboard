begin;
create or replace function public.result_mode(p_code text) returns jsonb language sql immutable set search_path='' as $$
 select case
 when p_code='T3' then '{"count":4,"kind":"roundRobin","A":[1,2,3,4],"pairs":[[2,3],[1,4],[2,4],[1,3],[3,4],[1,2]]}'::jsonb
 when p_code in ('T4','T5') then '{"count":5,"kind":"roundRobin","A":[1,2,3,4,5],"pairs":[[2,4],[1,5],[1,4],[2,3],[2,5],[3,4],[1,3],[4,5],[3,5],[1,2]]}'::jsonb
 when p_code in ('T7','T8') then '{"count":6,"kind":"roundRobin","A":[1,2,3,4,5,6],"pairs":[[2,5],[3,4],[1,6],[3,6],[1,5],[2,4],[1,4],[2,3],[5,6],[4,5],[2,6],[1,3],[1,2],[4,6],[3,5]]}'::jsonb
 when p_code in ('T11','T12') then '{"count":7,"kind":"roundRobin","A":[1,2,3,4,5,6,7],"pairs":[[3,6],[4,5],[2,7],[5,6],[4,7],[1,3],[2,4],[1,5],[6,7],[1,7],[2,6],[3,5],[3,4],[1,6],[2,5],[5,7],[2,3],[1,4],[1,2],[3,7],[4,6]]}'::jsonb
 when p_code='T10' then '{"count":7,"kind":"groupKo","A":[1,4,5],"B":[2,3,6,7]}'::jsonb
 when p_code='T15' then '{"count":8,"kind":"groupKo","A":[1,4,5,8],"B":[2,3,6,7]}'::jsonb
 when p_code='T16b' then '{"count":9,"kind":"groupKo","A":[1,4,9],"B":[2,5,8],"C":[3,6,7]}'::jsonb
 when p_code='T16' then '{"count":9,"kind":"groupKo","A":[1,4,5,7,9],"B":[2,3,6,8]}'::jsonb
 when p_code in ('T18','T19') then '{"count":10,"kind":"groupKo","A":[1,4,5,7,10],"B":[2,3,6,8,9]}'::jsonb
 else null end;
$$;
-- Compare equal group positions by PP, GD (three decimals), then HS.
create function public.t16b_position_ranking(p_snapshot jsonb,p_results jsonb,p_position integer) returns jsonb
language sql immutable set search_path='' as $$
 with candidates as (
 select public.result_group_stats(p_snapshot,p_results,g)->(p_position-1)||jsonb_build_object('group',g) as r from unnest(array['A','B','C']) g
 ), ranked as (
 select r,count(*) over(partition by r->>'points',r->>'gd',r->>'high')>1 as tied from candidates
 ) select jsonb_agg(r||jsonb_build_object('cross_tied',tied) order by (r->>'points')::integer desc,(r->>'gd')::numeric desc,(r->>'high')::integer desc,(r->>'seed')::integer) from ranked;
$$;
create function public.t16b_result_schedule(p_snapshot jsonb,p_results jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare plan jsonb;g jsonb;stats jsonb;winners jsonb;seconds jsonb;thirds jsonb;complete boolean:=true;
 runner integer;opponent integer;other1 integer;other2 integer;first1 integer;first2 integer;loser1 integer;loser2 integer;seventh integer;eighth integer;r jsonb;
begin
 plan:=public.result_group_pairs(p_snapshot,'A')||public.result_group_pairs(p_snapshot,'B')||public.result_group_pairs(p_snapshot,'C');
 for g in select value from jsonb_array_elements(plan) loop if not(p_results ? (g->>'key')) then complete:=false;end if;end loop;
 stats:=public.result_group_stats(p_snapshot,p_results,'A')||public.result_group_stats(p_snapshot,p_results,'B')||public.result_group_stats(p_snapshot,p_results,'C');
 if exists(select 1 from jsonb_array_elements(stats) where (value->>'tied')::boolean) then complete:=false;end if;
 winners:=public.t16b_position_ranking(p_snapshot,p_results,1);
 seconds:=public.t16b_position_ranking(p_snapshot,p_results,2);
 thirds:=public.t16b_position_ranking(p_snapshot,p_results,3);
 if exists(select 1 from jsonb_array_elements(seconds||thirds) where (value->>'cross_tied')::boolean) then complete:=false;end if;
 if complete then
  runner:=(seconds->0->>'seed')::integer;
  -- Best available group winner faces the best runner-up, avoiding a repeat.
  select (value->>'seed')::integer into opponent from jsonb_array_elements(winners) with ordinality x(value,ord) where value->>'group'<>seconds->0->>'group' order by ord limit 1;
  select (value->>'seed')::integer into other1 from jsonb_array_elements(winners) with ordinality x(value,ord) where (value->>'seed')::integer<>opponent order by ord limit 1;
  select (value->>'seed')::integer into other2 from jsonb_array_elements(winners) with ordinality x(value,ord) where (value->>'seed')::integer not in(opponent,other1) order by ord limit 1;
  r:=p_results->'HF1';if r is not null then first1:=case when (r->>'winner')::integer=1 then opponent else runner end;loser1:=case when (r->>'winner')::integer=1 then runner else opponent end;end if;
  r:=p_results->'HF2';if r is not null then first2:=case when (r->>'winner')::integer=1 then other1 else other2 end;loser2:=case when (r->>'winner')::integer=1 then other2 else other1 end;end if;
  r:=p_results->'P8';if r is not null then seventh:=(thirds->case when (r->>'winner')::integer=1 then 1 else 2 end->>'seed')::integer;eighth:=(thirds->0->>'seed')::integer;end if;
 end if;
 return plan||jsonb_build_array(
 jsonb_build_object('key','HF1','stage','final','label','Halbfinale 1','seed1',opponent,'seed2',runner,'ready',complete),
 jsonb_build_object('key','HF2','stage','final','label','Halbfinale 2','seed1',other1,'seed2',other2,'ready',complete),
 jsonb_build_object('key','P8','stage','final','label','Spiel um Platz 8','seed1',case when complete then (thirds->1->>'seed')::integer end,'seed2',case when complete then (thirds->2->>'seed')::integer end,'ready',complete),
 jsonb_build_object('key','P5','stage','final','label','Spiel um Platz 5','seed1',case when complete then (seconds->1->>'seed')::integer end,'seed2',case when complete then (seconds->2->>'seed')::integer end,'ready',complete),
 jsonb_build_object('key','P7','stage','final','label','Spiel um Platz 7','seed1',eighth,'seed2',seventh,'ready',seventh is not null),
 jsonb_build_object('key','P3','stage','final','label','Spiel um Platz 3','seed1',loser1,'seed2',loser2,'ready',first1 is not null and first2 is not null),
 jsonb_build_object('key','F','stage','final','label','Finale','seed1',first1,'seed2',first2,'ready',first1 is not null and first2 is not null));
end $$;
revoke all on function public.t16b_position_ranking(jsonb,jsonb,integer),public.t16b_result_schedule(jsonb,jsonb) from public,anon,authenticated;


create or replace function public.result_schedule(p_snapshot jsonb,p_results jsonb,p_order jsonb default '{}') returns jsonb language plpgsql immutable set search_path='' as $$
declare cfg jsonb:=public.result_mode(p_snapshot->>'selectedModeCode');out jsonb;g jsonb;a jsonb;b jsonb;complete boolean:=true;
 a1 integer;a2 integer;a3 integer;a4 integer;a5 integer;b1 integer;b2 integer;b3 integer;b4 integer;b5 integer;w1 integer;w2 integer;l1 integer;l2 integer;r jsonb;p8winner integer;
begin
 if p_snapshot->>'selectedModeCode'='T16b' then return public.t16b_result_schedule(p_snapshot,p_results);end if;
 if cfg is null then raise exception 'Nicht unterstützter Turniermodus.';end if;
 if p_snapshot->>'selectedModeCode'='T15' then return public.t15_schedule(p_results,p_order);end if;
 out:=public.result_group_pairs(p_snapshot,'A');
 if cfg->>'kind'='roundRobin' then return out;end if;
 out:=out||public.result_group_pairs(p_snapshot,'B');
 for g in select value from jsonb_array_elements(out) loop if not p_results ? (g->>'key') then complete:=false;end if;end loop;
 a:=public.result_group_stats(p_snapshot,p_results,'A');b:=public.result_group_stats(p_snapshot,p_results,'B');
 if exists(select 1 from jsonb_array_elements(a||b) where (value->>'tied')::boolean) then complete:=false;end if;
 if complete then
  a1:=(a->0->>'seed')::integer;a2:=(a->1->>'seed')::integer;a3:=(a->2->>'seed')::integer;
  b1:=(b->0->>'seed')::integer;b2:=(b->1->>'seed')::integer;b3:=(b->2->>'seed')::integer;b4:=(b->3->>'seed')::integer;
  a4:=(a->3->>'seed')::integer;a5:=(a->4->>'seed')::integer;b5:=(b->4->>'seed')::integer;
  r:=p_results->'P8';if r is not null then p8winner:=case when (r->>'winner')::integer=1 then a4 else a5 end;end if;
  r:=p_results->'HF1';if r is not null then w1:=case when (r->>'winner')::integer=1 then a1 else b2 end;l1:=case when (r->>'winner')::integer=1 then b2 else a1 end;end if;
  r:=p_results->'HF2';if r is not null then w2:=case when (r->>'winner')::integer=1 then b1 else a2 end;l2:=case when (r->>'winner')::integer=1 then a2 else b1 end;end if;
 end if;
 return out||jsonb_build_array(
 jsonb_build_object('key','HF1','stage','final','label','Halbfinale 1','seed1',a1,'seed2',b2,'ready',complete),
 jsonb_build_object('key','HF2','stage','final','label','Halbfinale 2','seed1',b1,'seed2',a2,'ready',complete)
 )||case when p_snapshot->>'selectedModeCode'='T16' then jsonb_build_array(
 jsonb_build_object('key','P8','stage','final','label','Spiel um Platz 8','seed1',a4,'seed2',a5,'ready',complete),
 jsonb_build_object('key','P7','stage','final','label','Spiel um Platz 7','seed1',p8winner,'seed2',b4,'ready',complete and p8winner is not null)) else '[]'::jsonb end||case when p_snapshot->>'selectedModeCode' in ('T18','T19') then jsonb_build_array(
 jsonb_build_object('key','P9','stage','final','label','Spiel um Platz 9','seed1',a5,'seed2',b5,'ready',complete),
 jsonb_build_object('key','P7','stage','final','label','Spiel um Platz 7','seed1',a4,'seed2',b4,'ready',complete)) else '[]'::jsonb end||jsonb_build_array(
 jsonb_build_object('key','P5','stage','final','label','Spiel um Platz 5','seed1',a3,'seed2',b3,'ready',complete),
 jsonb_build_object('key','P3','stage','final','label','Spiel um Platz 3','seed1',l1,'seed2',l2,'ready',w1 is not null and w2 is not null),
 jsonb_build_object('key','F','stage','final','label','Finale','seed1',w1,'seed2',w2,'ready',w1 is not null and w2 is not null));
end $$;
create or replace function public.save_t15_result(p_id uuid,p_key text,p_result jsonb,p_version integer,p_reset_dependents boolean default false) returns integer language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; old_state jsonb; g jsonb; v integer; f text; side integer; winner integer; remove_keys text[]:='{}'; k text; next_results jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 if e.status<>'open' then raise exception 'Turnier ist abgeschlossen. Die Turnierleitung muss es wieder öffnen.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Ein anderer Benutzer hat gespeichert. Bitte neu laden.';end if;
 select value into g from jsonb_array_elements(public.result_schedule(e.snapshot,e.results,e.group_order)) where value->>'key'=p_key;
 if g is null or not (g->>'ready')::boolean then raise exception 'Paarung steht noch nicht fest. Zuerst Gruppen und Gleichstände klären.';end if;
 old_state:=jsonb_build_object('results',e.results,'group_order',e.group_order,'version',e.version);
 if p_result is not null and p_result<>'null'::jsonb then
  for side in 1..2 loop
   foreach f in array array['score','innings','high'] loop
    if jsonb_typeof(p_result->(f||side)) is distinct from 'number' or (p_result->>(f||side)) !~ '^[0-9]+$' then raise exception 'Bitte vollständige ganzzahlige Ergebnisse eingeben.';end if;
    v:=(p_result->>(f||side))::integer;
    if v>1000000 then raise exception 'Eingabe ist zu groß.';end if;
   end loop;
   if (p_result->>('innings'||side))::integer<1 or (p_result->>('high'||side))::integer>(p_result->>('score'||side))::integer then raise exception 'Aufnahmen müssen positiv sein; HS darf die Punkte nicht überschreiten.';end if;
   if (p_result->>('score'||side))::integer>(e.snapshot->>'playingTargetPoints')::integer or (p_result->>('innings'||side))::integer>(e.snapshot->>'playingTargetInnings')::integer then raise exception 'Punkte oder Aufnahmen überschreiten das Spielziel des Turniers.';end if;
  end loop;
  p_result:=jsonb_build_object('score1',p_result->'score1','score2',p_result->'score2','innings1',p_result->'innings1','innings2',p_result->'innings2','high1',p_result->'high1','high2',p_result->'high2','winner',p_result->'winner');
  if g->>'stage'='final' then
   if (p_result->>'score1')::integer=(p_result->>'score2')::integer then
    winner:=(p_result->>'winner')::integer;if winner is null or winner not in(1,2) then raise exception 'Bei Gleichstand den Sieger nach Entscheid auswählen.';end if;
   else winner:=case when (p_result->>'score1')::integer>(p_result->>'score2')::integer then 1 else 2 end;end if;
   p_result:=p_result||jsonb_build_object('winner',winner);
  else p_result:=p_result-'winner';end if;
 end if;
 if (e.results->p_key) is not distinct from nullif(p_result,'null'::jsonb) then return e.version;end if;
 if g->>'stage' in ('A','B','C') then remove_keys:=array['HF1','HF2','P8','P9','P7','P5','P3','F'];
 elsif p_key in('HF1','HF2') then remove_keys:=array['P3','F'];elsif p_key='P8' then remove_keys:=array['P7'];end if;
 foreach k in array remove_keys loop
  if e.results ? k and not p_reset_dependents then raise exception 'DEPENDENTS_EXIST: Bereits erfasste Folgepartien müssen zurückgesetzt werden. Bitte bestätigen.';end if;
 end loop;
 next_results:=e.results-remove_keys;
 if p_result is null or p_result='null'::jsonb then next_results:=next_results-p_key;else next_results:=jsonb_set(next_results,array[p_key],p_result);end if;
 update public.result_events set results=next_results,group_order=case when g->>'stage' in('A','B','C') then group_order-(g->>'stage') else group_order end,version=version+1,updated_at=now() where id=p_id returning * into e;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state) values(p_id,auth.uid(),'Ergebnis '||p_key,old_state,jsonb_build_object('results',e.results,'group_order',e.group_order,'version',e.version));
 return e.version;
end $$;
create or replace function public.get_t15_result_event(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; members jsonb:='[]';
begin
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 select * into strict e from public.result_events where id=p_id;
 if public.result_can_manage(p_id) then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email) order by u.email),'[]') into members from public.result_event_members m join auth.users u on u.id=m.user_id where m.event_id=p_id;
 end if;
 return to_jsonb(e)||jsonb_build_object('can_manage',public.result_can_manage(p_id),'can_delete',public.is_admin(auth.uid()),'can_reload',public.result_can_manage(p_id) and e.status='open' and e.results='{}'::jsonb and not exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %'),'members',members,'schedule',coalesce(e.archived_ranking->'schedule',public.result_schedule(e.snapshot,e.results,e.group_order)),'standings',coalesce(e.archived_ranking->'standings',jsonb_build_object('A',public.result_group_stats(e.snapshot,e.results,'A'),'B',public.result_group_stats(e.snapshot,e.results,'B'),'C',public.result_group_stats(e.snapshot,e.results,'C'))));
end $$;
create or replace function public.update_result_from_invitation(p_id uuid,p_invitation jsonb,p_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;next_snapshot jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf Turnierdaten aktualisieren.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Der Turnierstand wurde inzwischen geändert. Bitte den Einladungsentwurf erneut öffnen.';end if;
 if e.status<>'open' or e.results<>'{}'::jsonb or exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %') then
  raise exception 'Turnierdaten können nur vor der ersten Ergebniserfassung aktualisiert werden.';
 end if;
 if coalesce(p_invitation->>'sourceUrl',p_invitation->>'link','') is distinct from e.source_url then raise exception 'Der zugehörige Termin darf nicht geändert werden.';end if;
 next_snapshot:=public.result_validate_snapshot(case when coalesce((e.snapshot->>'modeOverride')::boolean,false) then p_invitation||jsonb_build_object('selectedModeCode',e.snapshot->>'selectedModeCode','modeOverride',true) else p_invitation end);
 update public.result_events set snapshot=next_snapshot,title=coalesce(nullif(p_invitation->>'title',''),e.title),event_date=coalesce(p_invitation->>'date',p_invitation->>'eventDate',e.event_date),group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),'Turnierdaten aus Einladungsentwurf aktualisiert',jsonb_build_object('snapshot',e.snapshot,'version',e.version),jsonb_build_object('snapshot',next_snapshot,'version',e.version+1));
 return e.version+1;
end $$;
create or replace function public.result_sync_sent_invitation(p_invitation jsonb,p_owner uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;next_snapshot jsonb;src text:=coalesce(p_invitation->>'sourceUrl',p_invitation->>'link','');eid uuid;
begin
 -- Serialize creation and updates for concurrent sends of the same tournament.
 perform pg_advisory_xact_lock(hashtextextended(src,0));
 select * into e from public.result_events where source_url=src for update;
 if found then
  if e.status<>'open' or e.results<>'{}'::jsonb or exists(select 1 from public.result_event_history where event_id=e.id and action like 'Ergebnis %') then
   insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
   values(e.id,p_owner,'Einladungsupdate nicht übernommen: Erfassung begonnen',jsonb_build_object('snapshot',e.snapshot),jsonb_build_object('invitation',p_invitation));
   return jsonb_build_object('status','blocked','event_id',e.id,'message','Turnierdaten wurden nicht aktualisiert, weil die Ergebniserfassung bereits begonnen hat oder das Turnier abgeschlossen ist.');
  end if;
  next_snapshot:=public.result_validate_snapshot(case when coalesce((e.snapshot->>'modeOverride')::boolean,false) then p_invitation||jsonb_build_object('selectedModeCode',e.snapshot->>'selectedModeCode','modeOverride',true) else p_invitation end);
  update public.result_events set snapshot=next_snapshot,title=coalesce(nullif(p_invitation->>'title',''),e.title),event_date=coalesce(p_invitation->>'date',p_invitation->>'eventDate',e.event_date),group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=e.id;
  insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
  values(e.id,p_owner,'Turnierdaten aus versendeter Einladung aktualisiert',jsonb_build_object('snapshot',e.snapshot,'version',e.version),jsonb_build_object('snapshot',next_snapshot,'version',e.version+1));
  return jsonb_build_object('status','updated','event_id',e.id);
 end if;
 return jsonb_build_object('status','not_created');
end $$;
create or replace function public.refresh_t15_event_data(p_id uuid,p_invitation jsonb,p_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;next_snapshot jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf Turnierdaten neu laden.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Bitte neu laden.';end if;
 if e.status<>'open' or e.results<>'{}'::jsonb or exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %') then
  raise exception 'Turnierdaten können nur vor der ersten Ergebniserfassung neu geladen werden.';
 end if;
 if not coalesce((e.snapshot->>'modeOverride')::boolean,false) and p_invitation->>'selectedModeCode' is distinct from e.snapshot->>'selectedModeCode' then raise exception 'Der Turniermodus darf beim Neuladen nicht geändert werden.';end if;
 if p_invitation->>'sourceUrl' is distinct from e.source_url then raise exception 'Die ClubCloud-Quelle darf nicht geändert werden.';end if;
 next_snapshot:=public.result_validate_snapshot(case when coalesce((e.snapshot->>'modeOverride')::boolean,false) then p_invitation||jsonb_build_object('selectedModeCode',e.snapshot->>'selectedModeCode','modeOverride',true) else p_invitation end);
 update public.result_events set snapshot=next_snapshot,
 title=coalesce(nullif(trim(p_invitation->>'title'),''),e.title),event_date=coalesce(p_invitation->>'date',p_invitation->>'eventDate',e.event_date),
 group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),'Turnierdaten neu aus ClubCloud geladen',jsonb_build_object('snapshot',e.snapshot,'version',e.version),jsonb_build_object('snapshot',next_snapshot,'version',e.version+1));
 return e.version+1;
end $$;
create function public.change_result_mode(p_id uuid,p_mode text,p_version integer,p_reset boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;s jsonb;before_state jsonb;
begin
 perform pg_advisory_xact_lock(823104);
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf den Modus ändern.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Turnier wurde geändert. Bitte neu laden.';end if;
 if e.status<>'open' or e.archived_ranking is not null then raise exception 'Turnier zuerst für Korrekturen öffnen.';end if;
 if exists(select 1 from public.tournament_operation_tables where event_id=p_id) then raise exception 'Vor dem Moduswechsel den Displaybetrieb beenden.';end if;
 if public.result_mode(p_mode) is null then raise exception 'Dieser Modus wird nicht unterstützt.';end if;
 if (public.result_mode(p_mode)->>'count')::integer<>jsonb_array_length(e.snapshot->'participants') then raise exception 'Der Modus passt nicht zur Teilnehmerzahl.';end if;
 if e.snapshot->>'selectedModeCode'=p_mode then return e.version;end if;
 if not p_reset and (e.results<>'{}'::jsonb or exists(select 1 from public.tournament_live_games where event_id=p_id and version>0)) then raise exception 'RESET_REQUIRED: Beim Moduswechsel müssen Ergebnisse und Live-Spielstände zurückgesetzt werden.';end if;
 before_state:=jsonb_build_object('snapshot',e.snapshot,'results',e.results,'group_order',e.group_order,'version',e.version);
 s:=public.result_validate_snapshot(e.snapshot||jsonb_build_object('selectedModeCode',p_mode,'modeOverride',true));
 delete from public.tournament_live_games where event_id=p_id;
 update public.result_events set snapshot=s,results='{}',group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),'Turniermodus unabhängig von Einladung geändert',before_state,jsonb_build_object('snapshot',s,'results','{}'::jsonb,'version',e.version+1));
 return e.version+1;
end $$;
revoke all on function public.change_result_mode(uuid,text,integer,boolean) from public,anon;
grant execute on function public.change_result_mode(uuid,text,integer,boolean) to authenticated;
commit;
