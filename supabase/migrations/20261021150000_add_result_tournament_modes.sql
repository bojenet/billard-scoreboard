begin;
-- Keep existing RPC names for compatibility with open T15 browser sessions.
create function public.result_mode(p_code text) returns jsonb language sql immutable set search_path='' as $$
 select case
 when p_code='T3' then '{"count":4,"kind":"roundRobin","A":[1,2,3,4],"pairs":[[2,3],[1,4],[2,4],[1,3],[3,4],[1,2]]}'::jsonb
 when p_code in ('T4','T5') then '{"count":5,"kind":"roundRobin","A":[1,2,3,4,5],"pairs":[[2,4],[1,5],[1,4],[2,3],[2,5],[3,4],[1,3],[4,5],[3,5],[1,2]]}'::jsonb
 when p_code in ('T7','T8') then '{"count":6,"kind":"roundRobin","A":[1,2,3,4,5,6],"pairs":[[2,5],[3,4],[1,6],[3,6],[1,5],[2,4],[1,4],[2,3],[5,6],[4,5],[2,6],[1,3],[1,2],[4,6],[3,5]]}'::jsonb
 when p_code in ('T11','T12') then '{"count":7,"kind":"roundRobin","A":[1,2,3,4,5,6,7],"pairs":[[3,6],[4,5],[2,7],[5,6],[4,7],[1,3],[2,4],[1,5],[6,7],[1,7],[2,6],[3,5],[3,4],[1,6],[2,5],[5,7],[2,3],[1,4],[1,2],[3,7],[4,6]]}'::jsonb
 when p_code='T10' then '{"count":7,"kind":"groupKo","A":[1,4,5],"B":[2,3,6,7]}'::jsonb
 when p_code='T15' then '{"count":8,"kind":"groupKo","A":[1,4,5,8],"B":[2,3,6,7]}'::jsonb
 else null end;
$$;
create function public.result_validate_snapshot(p_invitation jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare cfg jsonb:=public.result_mode(p_invitation->>'selectedModeCode'); normalized jsonb:='[]';p jsonb;s integer;i integer:=0;seeds integer[]:='{}';n integer;
begin
 if cfg is null then raise exception 'Dieser Turniermodus wird noch nicht unterstützt.';end if;
 n:=(cfg->>'count')::integer;
 if jsonb_typeof(p_invitation->'participants') is distinct from 'array' then raise exception 'Die Teilnehmerliste fehlt.';end if;
 if jsonb_array_length(p_invitation->'participants')<>n then raise exception '% benötigt genau % Teilnehmer.',p_invitation->>'selectedModeCode',n;end if;
 if coalesce(p_invitation->>'playingTargetPoints','') !~ '^[0-9]+$' or coalesce(p_invitation->>'playingTargetInnings','') !~ '^[0-9]+$' then raise exception 'Punkte und Aufnahmen müssen positive ganze Zahlen sein.';end if;
 if (p_invitation->>'playingTargetPoints')::integer not between 1 and 1000000 or (p_invitation->>'playingTargetInnings')::integer not between 1 and 1000000 then raise exception 'Punkte und Aufnahmen müssen zwischen 1 und 1000000 liegen.';end if;
 for p in select value from jsonb_array_elements(p_invitation->'participants') loop
  i:=i+1;s:=coalesce(nullif(p->>'number','')::integer,i);
  if s not between 1 and n or s=any(seeds) or trim(coalesce(p->>'name',''))='' then raise exception 'Setzliste unvollständig oder doppelte Setzplätze.';end if;
  seeds:=array_append(seeds,s);normalized:=normalized||jsonb_build_array(p||jsonb_build_object('seed',s));
 end loop;
 return p_invitation||jsonb_build_object('participants',normalized);
end $$;
create function public.result_group_pairs(p_snapshot jsonb,p_group text) returns jsonb language plpgsql immutable set search_path='' as $$
declare cfg jsonb:=public.result_mode(p_snapshot->>'selectedModeCode');seeds jsonb;pairs jsonb;p jsonb;out jsonb:='[]';i integer:=0;rr boolean;
begin
 if cfg is null then raise exception 'Nicht unterstützter Turniermodus.';end if;
 seeds:=cfg->p_group;if seeds is null then return '[]';end if;
 rr:=cfg->>'kind'='roundRobin';
 pairs:=case when rr then cfg->'pairs' when jsonb_array_length(seeds)=3 then '[[1,3],[2,3],[1,2]]'::jsonb else '[[1,4],[2,3],[1,3],[4,2],[1,2],[3,4]]'::jsonb end;
 for p in select value from jsonb_array_elements(pairs) loop
  i:=i+1;
  out:=out||jsonb_build_array(jsonb_build_object('key',case when rr then 'R' else p_group end||i,'stage',p_group,'label','Partie '||i,'roundLabel',case when rr then 'Hauptrunde' else 'Gruppe '||p_group end,
    'seed1',case when rr then (p->>0)::integer else (seeds->>((p->>0)::integer-1))::integer end,
    'seed2',case when rr then (p->>1)::integer else (seeds->>((p->>1)::integer-1))::integer end,'ready',true));
 end loop;return out;
end $$;
create function public.result_group_stats(p_snapshot jsonb,p_results jsonb,p_group text) returns jsonb language plpgsql immutable set search_path='' as $$
declare cfg jsonb:=public.result_mode(p_snapshot->>'selectedModeCode');seed integer;g jsonb;r jsonb;side integer;points integer;balls integer;innings integer;high integer;played integer;out jsonb:='[]';ordered jsonb;
begin
 for seed in select value::integer from jsonb_array_elements_text(coalesce(cfg->p_group,'[]')) loop
  points:=0;balls:=0;innings:=0;high:=0;played:=0;
  for g in select value from jsonb_array_elements(public.result_group_pairs(p_snapshot,p_group)) loop
   r:=p_results->(g->>'key');if r is null then continue;end if;
   side:=case when (g->>'seed1')::integer=seed then 1 when (g->>'seed2')::integer=seed then 2 else 0 end;if side=0 then continue;end if;
   played:=played+1;balls:=balls+(r->>('score'||side))::integer;innings:=innings+(r->>('innings'||side))::integer;high:=greatest(high,(r->>('high'||side))::integer);
   points:=points+case when (r->>'score1')::integer=(r->>'score2')::integer then 1 when ((r->>'score1')::integer>(r->>'score2')::integer)=(side=1) then 2 else 0 end;
  end loop;
  out:=out||jsonb_build_array(jsonb_build_object('seed',seed,'points',points,'balls',balls,'innings',innings,'high',high,'played',played,'gd',case when innings>0 then trunc(balls::numeric/innings,3) else 0 end));
 end loop;
 select coalesce(jsonb_agg(v||jsonb_build_object('rank',rank,'tied',tie_count>1) order by rank,(v->>'seed')::integer),'[]') into ordered from (
 select value v,count(*) over(partition by value->>'points',value->>'gd',value->>'high') tie_count,
 rank() over(order by (value->>'points')::integer desc,(value->>'gd')::numeric desc,(value->>'high')::integer desc) rank from jsonb_array_elements(out)) q;
 return ordered;
end $$;
create function public.result_schedule(p_snapshot jsonb,p_results jsonb,p_order jsonb default '{}') returns jsonb language plpgsql immutable set search_path='' as $$
declare cfg jsonb:=public.result_mode(p_snapshot->>'selectedModeCode');out jsonb;g jsonb;a jsonb;b jsonb;complete boolean:=true;
 a1 integer;a2 integer;a3 integer;b1 integer;b2 integer;b3 integer;b4 integer;w1 integer;w2 integer;l1 integer;l2 integer;r jsonb;
begin
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
  r:=p_results->'HF1';if r is not null then w1:=case when (r->>'winner')::integer=1 then a1 else b2 end;l1:=case when (r->>'winner')::integer=1 then b2 else a1 end;end if;
  r:=p_results->'HF2';if r is not null then w2:=case when (r->>'winner')::integer=1 then b1 else a2 end;l2:=case when (r->>'winner')::integer=1 then a2 else b1 end;end if;
 end if;
 return out||jsonb_build_array(
 jsonb_build_object('key','HF1','stage','final','label','Halbfinale 1','seed1',a1,'seed2',b2,'ready',complete),
 jsonb_build_object('key','HF2','stage','final','label','Halbfinale 2','seed1',b1,'seed2',a2,'ready',complete),
 jsonb_build_object('key','P5','stage','final','label','Spiel um Platz 5','seed1',a3,'seed2',b3,'ready',complete),
 jsonb_build_object('key','P3','stage','final','label','Spiel um Platz 3','seed1',l1,'seed2',l2,'ready',w1 is not null and w2 is not null),
 jsonb_build_object('key','F','stage','final','label','Finale','seed1',w1,'seed2',w2,'ready',w1 is not null and w2 is not null));
end $$;

create or replace function public.result_create_internal(p_invitation jsonb,p_owner uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid;src text:=trim(coalesce(p_invitation->>'sourceUrl',p_invitation->>'link',''));snapshot jsonb;
begin
 if p_owner is null or src='' then raise exception 'Termin und verantwortliche Person fehlen.';end if;
 select id into eid from public.result_events where source_url=src;if found then return eid;end if;
 snapshot:=public.result_validate_snapshot(p_invitation);
 insert into public.result_events(owner_user_id,source_url,source_event_id,title,event_date,snapshot)
 values(p_owner,src,coalesce(p_invitation->>'eventId',''),coalesce(nullif(p_invitation->>'title',''),'Turnier'),coalesce(p_invitation->>'date',p_invitation->>'eventDate',''),snapshot)
 on conflict(source_url) do nothing returning id into eid;
 if eid is null then select id into eid from public.result_events where source_url=src;end if;return eid;
end $$;

create or replace function public.result_after_invitation_sent() returns trigger language plpgsql security definer set search_path='' as $$
declare draft public.calendar_invitation_drafts%rowtype;
begin
 if new.status='sent' and (tg_op='INSERT' or old.status is distinct from 'sent') then
  select * into draft from public.calendar_invitation_drafts where source_url=new.link;
  if found and draft.updated_by is not null and public.result_mode(draft.invitation->>'selectedModeCode') is not null then
   begin perform public.result_create_internal(draft.invitation,draft.updated_by);
   exception when others then raise warning 'Turniererfassung nicht angelegt: %',sqlerrm;end;
  end if;
 end if;
 return new;
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
 if g->>'stage' in ('A','B') then remove_keys:=array['HF1','HF2','P7','P5','P3','F'];
 elsif p_key in('HF1','HF2') then remove_keys:=array['P3','F'];end if;
 foreach k in array remove_keys loop
  if e.results ? k and not p_reset_dependents then raise exception 'DEPENDENTS_EXIST: Bereits erfasste Folgepartien müssen zurückgesetzt werden. Bitte bestätigen.';end if;
 end loop;
 next_results:=e.results-remove_keys;
 if p_result is null or p_result='null'::jsonb then next_results:=next_results-p_key;else next_results:=jsonb_set(next_results,array[p_key],p_result);end if;
 update public.result_events set results=next_results,group_order=case when g->>'stage' in('A','B') then group_order-(g->>'stage') else group_order end,version=version+1,updated_at=now() where id=p_id returning * into e;
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
 return to_jsonb(e)||jsonb_build_object('can_manage',public.result_can_manage(p_id),'can_reload',public.result_can_manage(p_id) and e.status='open' and e.results='{}'::jsonb and not exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %'),'members',members,'schedule',coalesce(e.archived_ranking->'schedule',public.result_schedule(e.snapshot,e.results,e.group_order)),'standings',coalesce(e.archived_ranking->'standings',jsonb_build_object('A',public.result_group_stats(e.snapshot,e.results,'A'),'B',public.result_group_stats(e.snapshot,e.results,'B'))));
end $$;



create or replace function public.set_t15_status(p_id uuid,p_status text,p_version integer) returns integer language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; g jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf abschließen oder wieder öffnen.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Bitte neu laden.';end if;
 if p_status='open' and e.archived_ranking is not null then raise exception 'Dieses abgeschlossene Turnier bleibt mit seiner bisherigen Wertung archiviert.';end if;
 if p_status not in('open','completed') then raise exception 'Ungültiger Status.';end if;
 if p_status='completed' then
  for g in select value from jsonb_array_elements(public.result_schedule(e.snapshot,e.results,e.group_order)) loop if not (g->>'ready')::boolean or not e.results ? (g->>'key') then raise exception 'Es fehlen vollständige Ergebnisse oder eindeutige Folgepaarungen.';end if;end loop;
 end if;
 update public.result_events set status=p_status,version=version+1,updated_at=now() where id=p_id returning version into p_version;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state) values(p_id,auth.uid(),'Status geändert',jsonb_build_object('status',e.status),jsonb_build_object('status',p_status));return p_version;
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
 if p_invitation->>'selectedModeCode' is distinct from e.snapshot->>'selectedModeCode' then raise exception 'Der Turniermodus darf beim Neuladen nicht geändert werden.';end if;
 if p_invitation->>'sourceUrl' is distinct from e.source_url then raise exception 'Die ClubCloud-Quelle darf nicht geändert werden.';end if;
 next_snapshot:=public.result_validate_snapshot(p_invitation);
 update public.result_events set snapshot=next_snapshot,
 title=coalesce(nullif(trim(p_invitation->>'title'),''),e.title),event_date=coalesce(p_invitation->>'date',p_invitation->>'eventDate',e.event_date),
 group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),'Turnierdaten neu aus ClubCloud geladen',jsonb_build_object('snapshot',e.snapshot,'version',e.version),jsonb_build_object('snapshot',next_snapshot,'version',e.version+1));
 return e.version+1;
end $$;

revoke all on function public.result_mode(text),public.result_validate_snapshot(jsonb),public.result_group_pairs(jsonb,text),public.result_group_stats(jsonb,jsonb,text),public.result_schedule(jsonb,jsonb,jsonb) from public,anon,authenticated;
commit;
