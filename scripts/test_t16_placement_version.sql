-- Run via a combined transaction: insert legacy fixture, apply migration, then assertions.
begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values('f3210000-0000-4000-8000-000000000001','placements@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3210000-0000-4000-8000-000000000001',true);
create temporary table placement_baseline(id uuid,invitation jsonb,row_data jsonb,schedule jsonb);
do $$declare inv jsonb;eid uuid;v integer:=1;g jsonb;r jsonb;begin
 select jsonb_build_object('sourceUrl','https://example.invalid/legacy-placement','selectedModeCode','T16','title','Legacy fixture','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into inv from generate_series(1,9) i;
 eid:=public.result_create_internal(inv,auth.uid());
 for g in select value from jsonb_array_elements(public.result_schedule(inv,'{}')) where value->>'stage'<>'final' loop
  r:=jsonb_build_object('score1',case when (g->>'seed1')::int<(g->>'seed2')::int then 100 else 50 end,'score2',case when (g->>'seed1')::int<(g->>'seed2')::int then 50 else 100 end,'innings1',20,'innings2',20,'high1',10,'high2',10);
  v:=public.save_t15_result(eid,g->>'key',r,v);
 end loop;
 v:=public.save_t15_result(eid,'P8','{"score1":50,"score2":100,"innings1":20,"innings2":20,"high1":10,"high2":10}',v);
 v:=public.save_t15_result(eid,'P7','{"score1":50,"score2":100,"innings1":20,"innings2":20,"high1":10,"high2":10}',v);
 insert into placement_baseline select id,inv,to_jsonb(e),public.result_schedule(snapshot,results,group_order) from public.result_events e where id=eid;
end $$;
-- APPLY_MIGRATION_HERE

do $$declare old_id uuid;inv jsonb;eid uuid;v integer:=1;g jsonb;r jsonb;s jsonb;plan jsonb;begin
 select id,invitation into old_id,inv from placement_baseline;
 if (select to_jsonb(e) from public.result_events e where id=old_id)<>(select row_data from placement_baseline) then raise exception 'Existing row was modified';end if;
 if (select public.result_schedule(snapshot,results,group_order) from public.result_events where id=old_id)<>(select schedule from placement_baseline) then raise exception 'Legacy pairing/result changed';end if;
 update public.result_events set snapshot=jsonb_set(snapshot,'{t16PlacementVersion}','2') where id=old_id;
 if (select snapshot ? 't16PlacementVersion' from public.result_events where id=old_id) then raise exception 'Legacy version upgraded on update';end if;
 inv:=inv||'{"sourceUrl":"https://example.invalid/new-placement"}';eid:=public.result_create_internal(inv,auth.uid());
 s:=public.get_t15_result_event(eid);
 if s->'snapshot'->>'t16PlacementVersion'<>'2' then raise exception 'New version missing';end if;
 v:=public.refresh_t15_event_data(eid,inv,v);
 if (public.get_t15_result_event(eid))->'snapshot'->>'t16PlacementVersion'<>'2' then raise exception 'Roster reload lost version';end if;
 for g in select value from jsonb_array_elements(public.result_schedule(inv,'{}')) where value->>'stage'<>'final' loop
  r:=jsonb_build_object('score1',case when (g->>'seed1')::int<(g->>'seed2')::int then 100 else 50 end,'score2',case when (g->>'seed1')::int<(g->>'seed2')::int then 50 else 100 end,'innings1',20,'innings2',20,'high1',10,'high2',10);
  v:=public.save_t15_result(eid,g->>'key',r,v);
 end loop;
 s:=public.get_t15_result_event(eid);plan:=s->'schedule';
 select value into g from jsonb_array_elements(plan) where value->>'key'='P8';
 if g->>'seed1'<>'9' or g->>'seed2'<>'8' or g->>'label'<>'Spiel um Platz 9' then raise exception 'Expected A5 vs B4 and ClubCloud label';end if;
 v:=public.save_t15_result(eid,'P8','{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":10,"high2":10}',v);
 s:=public.get_t15_result_event(eid);
 select value into g from jsonb_array_elements(s->'schedule') where value->>'key'='P7';
 if g->>'seed1'<>'7' or g->>'seed2'<>'9' or not(g->>'ready')::boolean then raise exception 'Expected A4 vs first-side winner';end if;
 v:=public.save_t15_result(eid,'P8','{"score1":50,"score2":100,"innings1":20,"innings2":20,"high1":10,"high2":10}',v);
 s:=public.get_t15_result_event(eid);
 select value into g from jsonb_array_elements(s->'schedule') where value->>'key'='P7';
 if g->>'seed1'<>'7' or g->>'seed2'<>'8' then raise exception 'Expected A4 vs second-side winner';end if;
 if (select public.result_schedule(snapshot,results,group_order) from public.result_events where id=old_id)<>(select schedule from placement_baseline) then raise exception 'Legacy changed after new tournament capture';end if;
end $$;
select 'PASS: existing rows/results/schedules identical, revised A5-B4 then A4-winner only on new events, both winner paths, immutable version through reload, ClubCloud round labels' result;
rollback;
