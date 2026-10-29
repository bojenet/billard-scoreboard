begin;
create or replace function public.result_mode(p_code text) returns jsonb language sql immutable set search_path='' as $$
 select case
 when p_code='T3' then '{"count":4,"kind":"roundRobin","A":[1,2,3,4],"pairs":[[2,3],[1,4],[2,4],[1,3],[3,4],[1,2]]}'::jsonb
 when p_code in ('T4','T5') then '{"count":5,"kind":"roundRobin","A":[1,2,3,4,5],"pairs":[[2,4],[1,5],[1,4],[2,3],[2,5],[3,4],[1,3],[4,5],[3,5],[1,2]]}'::jsonb
 when p_code in ('T7','T8') then '{"count":6,"kind":"roundRobin","A":[1,2,3,4,5,6],"pairs":[[2,5],[3,4],[1,6],[3,6],[1,5],[2,4],[1,4],[2,3],[5,6],[4,5],[2,6],[1,3],[1,2],[4,6],[3,5]]}'::jsonb
 when p_code in ('T11','T12') then '{"count":7,"kind":"roundRobin","A":[1,2,3,4,5,6,7],"pairs":[[3,6],[4,5],[2,7],[5,6],[4,7],[1,3],[2,4],[1,5],[6,7],[1,7],[2,6],[3,5],[3,4],[1,6],[2,5],[5,7],[2,3],[1,4],[1,2],[3,7],[4,6]]}'::jsonb
 when p_code='T10' then '{"count":7,"kind":"groupKo","A":[1,4,5],"B":[2,3,6,7]}'::jsonb
 when p_code='T15' then '{"count":8,"kind":"groupKo","A":[1,4,5,8],"B":[2,3,6,7]}'::jsonb
 when p_code in ('T18','T19') then '{"count":10,"kind":"groupKo","A":[1,4,5,7,10],"B":[2,3,6,8,9]}'::jsonb
 else null end;
$$;

create or replace function public.result_schedule(p_snapshot jsonb,p_results jsonb,p_order jsonb default '{}') returns jsonb language plpgsql immutable set search_path='' as $$
declare cfg jsonb:=public.result_mode(p_snapshot->>'selectedModeCode');out jsonb;g jsonb;a jsonb;b jsonb;complete boolean:=true;
 a1 integer;a2 integer;a3 integer;a4 integer;a5 integer;b1 integer;b2 integer;b3 integer;b4 integer;b5 integer;w1 integer;w2 integer;l1 integer;l2 integer;r jsonb;
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
  a4:=(a->3->>'seed')::integer;a5:=(a->4->>'seed')::integer;b5:=(b->4->>'seed')::integer;
  r:=p_results->'HF1';if r is not null then w1:=case when (r->>'winner')::integer=1 then a1 else b2 end;l1:=case when (r->>'winner')::integer=1 then b2 else a1 end;end if;
  r:=p_results->'HF2';if r is not null then w2:=case when (r->>'winner')::integer=1 then b1 else a2 end;l2:=case when (r->>'winner')::integer=1 then a2 else b1 end;end if;
 end if;
 return out||jsonb_build_array(
 jsonb_build_object('key','HF1','stage','final','label','Halbfinale 1','seed1',a1,'seed2',b2,'ready',complete),
 jsonb_build_object('key','HF2','stage','final','label','Halbfinale 2','seed1',b1,'seed2',a2,'ready',complete)
 )||case when p_snapshot->>'selectedModeCode' in ('T18','T19') then jsonb_build_array(
 jsonb_build_object('key','P9','stage','final','label','Spiel um Platz 9','seed1',a5,'seed2',b5,'ready',complete),
 jsonb_build_object('key','P7','stage','final','label','Spiel um Platz 7','seed1',a4,'seed2',b4,'ready',complete)) else '[]'::jsonb end||jsonb_build_array(
 jsonb_build_object('key','P5','stage','final','label','Spiel um Platz 5','seed1',a3,'seed2',b3,'ready',complete),
 jsonb_build_object('key','P3','stage','final','label','Spiel um Platz 3','seed1',l1,'seed2',l2,'ready',w1 is not null and w2 is not null),
 jsonb_build_object('key','F','stage','final','label','Finale','seed1',w1,'seed2',w2,'ready',w1 is not null and w2 is not null));
end $$;
commit;
