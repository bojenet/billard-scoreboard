begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values('f3150000-0000-4000-8000-000000000092','automatic-dispatch@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000092',true);
update public.user_roles set role='admin' where user_id=auth.uid();
update public.tournament_operation_tables set event_id=null,assignment=null,paused=false,last_seen=now();
create function pg_temp.begin_run(mode text,label text,ids text[] default array['tb01','tb02']) returns uuid language plpgsql as $$
declare inv jsonb;eid uuid;n integer:=(public.result_mode(mode)->>'count')::integer;
begin
 select jsonb_build_object('sourceUrl','https://example.invalid/automatic/'||label,'selectedModeCode',mode,'tableIds',to_jsonb(ids),'title','Automatic '||label,'playingTargetPoints','2','playingTargetInnings','1','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into inv from generate_series(1,n) i;
 eid:=public.create_t15_result_event(inv);
 update public.tournament_operation_tables set last_seen=now() where id=any(ids);
 perform public.tournament_operation('start',null,eid);
 return eid;
end $$;
create function pg_temp.win_game(tid text) returns void language plpgsql as $$
declare d jsonb;eid uuid;key text;side integer;begin
 d:=public.tournament_table_state(tid);eid:=(d->>'event_id')::uuid;key:=d->'assignment'->>'key';
 side:=case when (d->'assignment'->>'seed1')::integer<(d->'assignment'->>'seed2')::integer then 1 else 2 end;
 if side=1 then d:=public.tournament_table_input(tid,eid,key,(d->>'live_version')::integer,'points',2);end if;
 d:=public.tournament_table_input(tid,eid,key,(d->>'live_version')::integer,'turn');
 if side=2 then d:=public.tournament_table_input(tid,eid,key,(d->>'live_version')::integer,'points',2);end if;
 d:=public.tournament_table_input(tid,eid,key,(d->>'live_version')::integer,'turn');
 if not exists(select 1 from public.result_events where id=eid and results ? key) then raise exception 'Turn did not automatically save %',key;end if;
end $$;
-- Existing two saved first games must immediately become games 3 and 4.
do $$declare eid uuid;d jsonb;r jsonb:='{"score1":2,"score2":0,"innings1":1,"innings2":1,"high1":2,"high2":0}';v integer:=1;begin
 eid:=pg_temp.begin_run('T4','recovery');
 v:=public.save_t15_result(eid,'R1',r,v);v:=public.save_t15_result(eid,'R2',r,v);
 perform public.tournament_operation('pause',null,eid);perform public.tournament_operation('heartbeat','tb01');
 if (select assignment->>'key' from public.tournament_operation_tables where id='tb01')<>'R1' then raise exception 'Advanced while paused';end if;
 perform public.tournament_operation('resume',null,eid);
 if (select assignment->>'key' from public.tournament_operation_tables where id='tb01')<>'R3' or (select assignment->>'key' from public.tournament_operation_tables where id='tb02')<>'R4' then raise exception 'Saved first round did not advance';end if;
 perform public.tournament_operation('state');perform public.tournament_operation('heartbeat','tb01');
 if (select assignment->>'key' from public.tournament_operation_tables where id='tb01')<>'R3' then raise exception 'Repeated heartbeat reassigned a running match';end if;
 begin perform public.tournament_table_input('tb01',eid,'R1',0,'points',1);raise exception 'Late input entered next match';exception when others then if position('Tischzuordnung' in sqlerrm)=0 then raise;end if;end;
 -- Offline running games stay reserved; offline free tables receive nothing new.
 update public.tournament_operation_tables set last_seen=now()-interval '1 hour' where id='tb02';
 perform pg_temp.win_game('tb01');
 if (select assignment->>'key' from public.tournament_operation_tables where id='tb02')<>'R4' then raise exception 'Offline running match replaced';end if;
 perform public.tournament_operation('stop',null,eid);
end $$;
-- A last turn persisted by an older display is also recovered automatically.
do $$declare eid uuid;d jsonb;key text;begin
 eid:=pg_temp.begin_run('T3','finished-live');d:=public.tournament_table_state('tb01');key:=d->'assignment'->>'key';
 insert into public.tournament_live_games(event_id,game_key,state,version) values(eid,key,public.tournament_initial_score()||'{"score1":2,"score2":1,"innings1":1,"innings2":1,"high1":2,"high2":1,"done":true}',1);
 perform public.tournament_operation('heartbeat','tb01');
 if not exists(select 1 from public.result_events where id=eid and results ? key) then raise exception 'Finished older display was not recovered';end if;
 perform public.tournament_operation('stop',null,eid);
end $$;
-- Simulate complete tournaments across all supported structures, without finish calls.
do $$declare code text;eid uuid;tid text;count_steps integer;seed_count integer;unique_seeds integer;key_count integer;unique_keys integer;expected integer;before_game text;begin
 foreach code in array array['T3','T4','T7','T11','T10','T15'] loop
  eid:=pg_temp.begin_run(code,code,case when code in ('T10','T15') then array['tb01','tb02','tb03','tb04'] else array['tb01','tb02'] end);
  expected:=case code when 'T3' then 6 when 'T4' then 10 when 'T7' then 15 when 'T11' then 21 when 'T10' then 14 else 18 end;
  count_steps:=0;
  while (select status from public.result_events where id=eid)='open' loop
   select count(*),count(distinct seed) into seed_count,unique_seeds from (
    select assignment->>'seed1' seed from public.tournament_operation_tables where event_id=eid and assignment is not null
    union all select assignment->>'seed2' from public.tournament_operation_tables where event_id=eid and assignment is not null) x;
   select count(*),count(distinct assignment->>'key') into key_count,unique_keys from public.tournament_operation_tables where event_id=eid and assignment is not null;
   if seed_count<>unique_seeds or key_count<>unique_keys then raise exception 'Duplicate player/game in %',code;end if;
   select id into tid from public.tournament_operation_tables where event_id=eid and assignment is not null order by id limit 1;
   if tid is null then raise exception 'Automated run stalled for % after % games',code,count_steps;end if;
   perform pg_temp.win_game(tid);count_steps:=count_steps+1;
   if count_steps>expected then raise exception 'Game repeated for %',code;end if;
  end loop;
  if count_steps<>expected or (select count(*) from jsonb_object_keys((select results from public.result_events where id=eid)))<>expected then raise exception 'Missing results in %',code;end if;
  if exists(select 1 from public.tournament_operation_tables where event_id=eid) then raise exception 'Completed tournament kept tables occupied';end if;
  if not exists(select 1 from public.tournament_operation_tables where completion->>'event_id'=eid::text) then raise exception 'Completion display missing';end if;
  if not exists(select 1 from public.result_event_history where event_id=eid and action='Turnier automatisch abgeschlossen') then raise exception 'Auto-completion audit missing';end if;
 end loop;
 delete from public.result_events where id=eid;
 if exists(select 1 from public.tournament_operation_tables where completion->>'event_id'=eid::text) then raise exception 'Deleted tournament retained on waiting screen';end if;
end $$;
set local role authenticated;
do $$begin
 begin perform public.tournament_dispatch_event(null);exception when insufficient_privilege then return;end;raise exception 'Internal scheduler exposed as client RPC';
end $$;
reset role;
select 'PASS: saved-game recovery, paused/idempotent scheduling, stale-input rejection, offline reservations, finished-live recovery, full T3/T4/T7/T11/T10/T15 runs, unique players/games, automatic save/final stages/completion, internal permissions' result;
rollback;
