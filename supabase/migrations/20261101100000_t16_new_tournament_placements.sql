begin;
-- Only newly INSERTed tournaments receive the revised rules. The marker is
-- immutable across roster reloads and mode changes; existing rows stay untouched.
create function public.result_preserve_placement_version() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.snapshot:=jsonb_set(new.snapshot,'{t16PlacementVersion}','2'::jsonb);
 else
  new.snapshot:=new.snapshot-'t16PlacementVersion';
  if old.snapshot ? 't16PlacementVersion' then new.snapshot:=new.snapshot||jsonb_build_object('t16PlacementVersion',old.snapshot->'t16PlacementVersion');end if;
 end if;
 return new;
end $$;
revoke all on function public.result_preserve_placement_version() from public,anon,authenticated;
-- Run before the existing started-live-game protection trigger.
create trigger a_result_placement_version before insert or update of snapshot on public.result_events for each row execute function public.result_preserve_placement_version();
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
  r:=p_results->'P8';if r is not null then p8winner:=case when coalesce((p_snapshot->>'t16PlacementVersion')::integer,1)>=2 then case when (r->>'winner')::integer=1 then a5 else b4 end else case when (r->>'winner')::integer=1 then a4 else a5 end end;end if;
  r:=p_results->'HF1';if r is not null then w1:=case when (r->>'winner')::integer=1 then a1 else b2 end;l1:=case when (r->>'winner')::integer=1 then b2 else a1 end;end if;
  r:=p_results->'HF2';if r is not null then w2:=case when (r->>'winner')::integer=1 then b1 else a2 end;l2:=case when (r->>'winner')::integer=1 then a2 else b1 end;end if;
 end if;
 return out||jsonb_build_array(
 jsonb_build_object('key','HF1','stage','final','label','Halbfinale 1','seed1',a1,'seed2',b2,'ready',complete),
 jsonb_build_object('key','HF2','stage','final','label','Halbfinale 2','seed1',b1,'seed2',a2,'ready',complete)
 )||case when p_snapshot->>'selectedModeCode'='T16' then jsonb_build_array(
 jsonb_build_object('key','P8','stage','final','label',case when coalesce((p_snapshot->>'t16PlacementVersion')::integer,1)>=2 then 'Spiel um Platz 9' else 'Spiel um Platz 8' end,'seed1',case when coalesce((p_snapshot->>'t16PlacementVersion')::integer,1)>=2 then a5 else a4 end,'seed2',case when coalesce((p_snapshot->>'t16PlacementVersion')::integer,1)>=2 then b4 else a5 end,'ready',complete),
 jsonb_build_object('key','P7','stage','final','label',case when coalesce((p_snapshot->>'t16PlacementVersion')::integer,1)>=2 then 'Spiel um Platz 7' else 'Spiel um Platz 7' end,'seed1',case when coalesce((p_snapshot->>'t16PlacementVersion')::integer,1)>=2 then a4 else p8winner end,'seed2',case when coalesce((p_snapshot->>'t16PlacementVersion')::integer,1)>=2 then p8winner else b4 end,'ready',complete and p8winner is not null)) else '[]'::jsonb end||case when p_snapshot->>'selectedModeCode' in ('T18','T19') then jsonb_build_array(
 jsonb_build_object('key','P9','stage','final','label','Spiel um Platz 9','seed1',a5,'seed2',b5,'ready',complete),
 jsonb_build_object('key','P7','stage','final','label','Spiel um Platz 7','seed1',a4,'seed2',b4,'ready',complete)) else '[]'::jsonb end||jsonb_build_array(
 jsonb_build_object('key','P5','stage','final','label','Spiel um Platz 5','seed1',a3,'seed2',b3,'ready',complete),
 jsonb_build_object('key','P3','stage','final','label','Spiel um Platz 3','seed1',l1,'seed2',l2,'ready',w1 is not null and w2 is not null),
 jsonb_build_object('key','F','stage','final','label','Finale','seed1',w1,'seed2',w2,'ready',w1 is not null and w2 is not null));
end $$;
commit;
