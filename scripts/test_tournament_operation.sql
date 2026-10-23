begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values ('f3150000-0000-4000-8000-000000000081','operation-test@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000081',true);
do $$declare inv jsonb;eid uuid;state jsonb;begin
 begin perform public.tournament_operation('state');raise exception 'Denied user allowed';exception when others then if position('Nur Administratoren' in sqlerrm)=0 then raise;end if;end;
 update public.user_roles set role='admin' where user_id=auth.uid();
 select jsonb_build_object('sourceUrl','https://example.invalid/runtime-test','selectedModeCode','T3','title','Runtime test','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into inv from generate_series(1,4) i;
 eid:=public.create_t15_result_event(inv);
 -- Isolate table fixtures within the rolled-back transaction.
 update public.tournament_operation_tables set event_id=null,assignment=null,last_seen=null;
 begin perform public.tournament_operation('start',null,eid,array['tb01']);raise exception 'Offline allowed';exception when others then if position('offline' in sqlerrm)=0 then raise;end if;end;
 perform public.tournament_operation('heartbeat','tb01');perform public.tournament_operation('heartbeat','tb02');
 perform public.tournament_operation('start',null,eid,array['tb01','tb02']);
 if (select count(*) from public.tournament_operation_tables where event_id=eid and assignment is not null)<>2 then raise exception 'Expected two matches';end if;
 if (select count(distinct seed) from (select assignment->>'seed1' seed from public.tournament_operation_tables where event_id=eid union all select assignment->>'seed2' from public.tournament_operation_tables where event_id=eid) s)<>4 then raise exception 'Players assigned twice';end if;
 perform public.tournament_operation('pause',null,eid);if exists(select 1 from public.tournament_operation_tables where event_id=eid and not paused) then raise exception 'Pause failed';end if;
 perform public.tournament_operation('resume',null,eid);
 perform public.tournament_operation('stop',null,eid);if exists(select 1 from public.tournament_operation_tables where event_id=eid) then raise exception 'Stop failed';end if;
 if (select results from public.result_events where id=eid)<>'{}'::jsonb then raise exception 'Results modified';end if;
end $$;
select 'PASS: admin gate, offline check, two tables, unique players, pause/resume/stop, results untouched' as result;
rollback;
