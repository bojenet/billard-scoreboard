begin;
-- Preserve the original standings and pairings of already completed tournaments.
lock table public.result_events in share row exclusive mode;
alter table public.result_events add column archived_ranking jsonb;
update public.result_events e set archived_ranking=jsonb_build_object(
 'schedule',public.t15_schedule(e.results,e.group_order),
 'standings',jsonb_build_object('A',public.t15_group_stats(e.results,'A',coalesce(e.group_order->'A','[]')),'B',public.t15_group_stats(e.results,'B',coalesce(e.group_order->'B','[]'))))
 where status='completed';
create temporary table previous_t15_pairings on commit drop as
 select e.id,g->>'key' key,g->>'seed1' seed1,g->>'seed2' seed2
 from public.result_events e cross join lateral jsonb_array_elements(public.t15_schedule(e.results,e.group_order)) g
 where e.status<>'completed' and g->>'stage'='final' and e.results ? (g->>'key');
create or replace function public.t15_group_stats(p_results jsonb,p_group text,p_order jsonb default '[]') returns jsonb language plpgsql immutable set search_path='' as $$
declare seed integer; seeds integer[]; g jsonb; r jsonb; side integer; points integer; balls integer; innings integer; high integer; played integer; output jsonb:='[]'; ordered jsonb;
begin
 seeds:=case p_group when 'A' then array[1,4,5,8] when 'B' then array[2,3,6,7] end;
 foreach seed in array seeds loop
  points:=0;balls:=0;innings:=0;high:=0;played:=0;
  for g in select value from jsonb_array_elements(public.t15_group_pairs(p_group)) loop
   r:=p_results->(g->>'key'); if r is null then continue; end if;
   side:=case when (g->>'seed1')::integer=seed then 1 when (g->>'seed2')::integer=seed then 2 else 0 end;
   if side=0 then continue; end if;
   played:=played+1;
   balls:=balls+(r->>('score'||side))::integer;
   innings:=innings+(r->>('innings'||side))::integer;
   high:=greatest(high,(r->>('high'||side))::integer);
   points:=points+case when (r->>'score1')::integer=(r->>'score2')::integer then 1 when ((r->>'score1')::integer>(r->>'score2')::integer)=(side=1) then 2 else 0 end;
  end loop;
  output:=output||jsonb_build_array(jsonb_build_object('seed',seed,'points',points,'balls',balls,'innings',innings,'high',high,'played',played,'gd',case when innings>0 then trunc(balls::numeric/innings,3) else 0 end));
 end loop;
 select jsonb_agg(v||jsonb_build_object('rank',rank,'tied',tie_count>1) order by rank,(v->>'seed')::integer) into ordered from (
  select value v,count(*) over(partition by value->>'points',value->>'gd',value->>'high') tie_count,
   rank() over(order by (value->>'points')::integer desc,(value->>'gd')::numeric desc,(value->>'high')::integer desc) rank
  from jsonb_array_elements(output)
 ) q;
 return ordered;
end $$;

create or replace function public.t15_schedule(p_results jsonb,p_order jsonb default '{}') returns jsonb language plpgsql immutable set search_path='' as $$
declare a jsonb; b jsonb; g jsonb; output jsonb; complete boolean:=true; a1 integer; a2 integer; a3 integer; a4 integer; b1 integer; b2 integer; b3 integer; b4 integer; w1 integer; w2 integer; l1 integer; l2 integer; r jsonb;
begin
 output:=public.t15_group_pairs('A')||public.t15_group_pairs('B');
 for g in select value from jsonb_array_elements(output) loop if not (p_results ? (g->>'key')) then complete:=false; end if; end loop;
 a:=public.t15_group_stats(p_results,'A',coalesce(p_order->'A','[]')); b:=public.t15_group_stats(p_results,'B',coalesce(p_order->'B','[]'));
 if exists(select 1 from jsonb_array_elements(a||b) where (value->>'tied')::boolean) then complete:=false;end if;
 if complete then
  a1:=(a->0->>'seed')::integer;a2:=(a->1->>'seed')::integer;a3:=(a->2->>'seed')::integer;a4:=(a->3->>'seed')::integer;
  b1:=(b->0->>'seed')::integer;b2:=(b->1->>'seed')::integer;b3:=(b->2->>'seed')::integer;b4:=(b->3->>'seed')::integer;
  r:=p_results->'HF1';if r is not null then w1:=case when (r->>'winner')::integer=1 then a1 else b2 end;l1:=case when (r->>'winner')::integer=1 then b2 else a1 end;end if;
  r:=p_results->'HF2';if r is not null then w2:=case when (r->>'winner')::integer=1 then b1 else a2 end;l2:=case when (r->>'winner')::integer=1 then a2 else b1 end;end if;
 end if;
 output:=output||jsonb_build_array(
  jsonb_build_object('key','HF1','stage','final','label','Halbfinale 1','seed1',a1,'seed2',b2,'ready',complete),
  jsonb_build_object('key','HF2','stage','final','label','Halbfinale 2','seed1',b1,'seed2',a2,'ready',complete),
  jsonb_build_object('key','P7','stage','final','label','Spiel um Platz 7','seed1',a4,'seed2',b4,'ready',complete),
  jsonb_build_object('key','P5','stage','final','label','Spiel um Platz 5','seed1',a3,'seed2',b3,'ready',complete),
  jsonb_build_object('key','P3','stage','final','label','Spiel um Platz 3','seed1',l1,'seed2',l2,'ready',w1 is not null and w2 is not null),
  jsonb_build_object('key','F','stage','final','label','Finale','seed1',w1,'seed2',w2,'ready',w1 is not null and w2 is not null));
 return output;
end $$;


do $$begin
 if exists(select 1 from previous_t15_pairings old_pair join public.result_events e on e.id=old_pair.id
 cross join lateral jsonb_array_elements(public.t15_schedule(e.results,e.group_order)) g
 where g->>'key'=old_pair.key and ((g->>'seed1') is distinct from old_pair.seed1 or (g->>'seed2') is distinct from old_pair.seed2 or not (g->>'ready')::boolean)) then
  raise exception 'Die neue Rangfolge würde gespeicherte Finalpaarungen verändern. Vorhandene Folgeergebnisse müssen zuerst ausdrücklich geprüft und korrigiert werden.';
 end if;
end $$;
drop function public.set_t15_group_order(uuid,text,jsonb,integer,boolean);

create or replace function public.set_t15_status(p_id uuid,p_status text,p_version integer) returns integer language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; g jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf abschließen oder wieder öffnen.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Bitte neu laden.';end if;
 if p_status='open' and e.archived_ranking is not null then raise exception 'Dieses abgeschlossene Turnier bleibt mit seiner bisherigen Wertung archiviert.';end if;
 if p_status not in('open','completed') then raise exception 'Ungültiger Status.';end if;
 if p_status='completed' then
  for g in select value from jsonb_array_elements(public.t15_schedule(e.results,e.group_order)) loop if not (g->>'ready')::boolean or not e.results ? (g->>'key') then raise exception 'Es fehlen vollständige Ergebnisse oder eindeutige Folgepaarungen.';end if;end loop;
 end if;
 update public.result_events set status=p_status,version=version+1,updated_at=now() where id=p_id returning version into p_version;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state) values(p_id,auth.uid(),'Status geändert',jsonb_build_object('status',e.status),jsonb_build_object('status',p_status));return p_version;
end $$;

create or replace function public.get_t15_result_event(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; members jsonb:='[]';
begin
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 select * into strict e from public.result_events where id=p_id;
 if public.result_can_manage(p_id) then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email) order by u.email),'[]') into members from public.result_event_members m join auth.users u on u.id=m.user_id where m.event_id=p_id;
 end if;
 return to_jsonb(e)||jsonb_build_object('can_manage',public.result_can_manage(p_id),'members',members,'schedule',coalesce(e.archived_ranking->'schedule',public.t15_schedule(e.results,e.group_order)),'standings',coalesce(e.archived_ranking->'standings',jsonb_build_object('A',public.t15_group_stats(e.results,'A',coalesce(e.group_order->'A','[]')),'B',public.t15_group_stats(e.results,'B',coalesce(e.group_order->'B','[]')))));
end $$;

commit;
