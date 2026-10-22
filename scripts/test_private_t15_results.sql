-- Run against a database with the T15 migration. Everything is rolled back.
begin;
create function pg_temp.expect_t15_error(statement text,fragment text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then
  if position(fragment in sqlerrm)>0 then return;end if;raise;
 end;
 raise exception 'Expected error containing %, but statement succeeded',fragment;
end $$;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3150000-0000-4000-8000-000000000001','t15-owner@example.invalid','{}','{}',now(),now()),
('f3150000-0000-4000-8000-000000000002','t15-editor@example.invalid','{}','{}',now(),now()),
('f3150000-0000-4000-8000-000000000003','t15-outsider@example.invalid','{}','{}',now(),now());
create temp table test_t15_ids(id uuid);
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000001',true);
do $$
declare invitation jsonb; eid uuid; g jsonb; r jsonb; v integer:=1; state jsonb;
begin
 select jsonb_build_object('selectedModeCode','T15','enableResultEntry',true,'sourceUrl','https://example.invalid/t15-test','eventId','t15-test','title','T15 Test','discipline','Dreiband','playingTargetPoints','25','playingTargetInnings','40','participants',jsonb_agg(jsonb_build_object('number',i::text,'name','Spieler '||i,'passNo','test-'||i,'club','Testverein'))) into invitation from generate_series(1,8) i;
 if public.create_t15_result_event(invitation) is null then raise exception 'Manual creation before sending failed';end if;
 eid:=public.result_create_internal(invitation,auth.uid());insert into test_t15_ids values(eid);
 if public.result_create_internal(invitation,auth.uid())<>eid then raise exception 'Duplicate event';end if;
 if jsonb_array_length(public.t15_schedule('{}'))<>18 then raise exception 'Wrong match count';end if;
 if public.t15_group_pairs('A')->0->>'seed1'<>'1' or public.t15_group_pairs('A')->0->>'seed2'<>'8' then raise exception 'Wrong T15 group seeding';end if;
 perform pg_temp.expect_t15_error(format('select public.save_t15_result(%L,%L,%L::jsonb,1)',eid,'HF1','{"score1":25,"score2":15,"innings1":30,"innings2":30,"high1":5,"high2":4}'),'Paarung');
 for g in select value from jsonb_array_elements(public.t15_group_pairs('A')||public.t15_group_pairs('B')) loop
  r:=jsonb_build_object('score1',case when (g->>'seed1')::integer<(g->>'seed2')::integer then 25 else 15 end,'score2',case when (g->>'seed1')::integer<(g->>'seed2')::integer then 15 else 25 end,'innings1',30,'innings2',30,'high1',5,'high2',4);
  v:=public.save_t15_result(eid,g->>'key',r,v);
 end loop;
 state:=public.get_t15_result_event(eid);
 if state->'standings'->'A'->0->>'seed'<>'1' or state->'standings'->'B'->0->>'seed'<>'2' then raise exception 'Wrong group standings';end if;
 select value into g from jsonb_array_elements(state->'schedule') where value->>'key'='HF1';
 if g->>'seed1'<>'1' or g->>'seed2'<>'3' or not (g->>'ready')::boolean then raise exception 'Wrong crossover semifinal: %',g;end if;
 perform pg_temp.expect_t15_error(format('select public.save_t15_result(%L,%L,%L::jsonb,1)',eid,'A1',r),'VERSION_CONFLICT');
 perform pg_temp.expect_t15_error(format('select public.save_t15_result(%L,%L,%L::jsonb,null)',eid,'A1',r),'VERSION_CONFLICT');
 perform pg_temp.expect_t15_error(format('select public.save_t15_result(%L,%L,%L::jsonb,%s)',eid,'HF1','{"score1":25,"score2":25,"innings1":30,"innings2":30,"high1":5,"high2":4}',v),'Entscheid');
 r:='{"score1":25,"score2":25,"innings1":30,"innings2":30,"high1":5,"high2":4,"winner":2}';v:=public.save_t15_result(eid,'HF1',r,v);
 r:='{"score1":25,"score2":15,"innings1":30,"innings2":30,"high1":5,"high2":4}';v:=public.save_t15_result(eid,'HF2',r,v);
 state:=public.get_t15_result_event(eid);select value into g from jsonb_array_elements(state->'schedule') where value->>'key'='F';
 if g->>'seed1'<>'3' or g->>'seed2'<>'2' then raise exception 'Wrong final winners';end if;
 foreach r in array array['{"score1":25,"score2":15,"innings1":30,"innings2":30,"high1":5,"high2":4}'::jsonb] loop
  v:=public.save_t15_result(eid,'P7',r,v);v:=public.save_t15_result(eid,'P5',r,v);v:=public.save_t15_result(eid,'P3',r,v);v:=public.save_t15_result(eid,'F',r,v);
 end loop;
 v:=public.set_t15_status(eid,'completed',v);
 perform pg_temp.expect_t15_error(format('select public.save_t15_result(%L,%L,%L::jsonb,%s)',eid,'F',r,v),'abgeschlossen');
 v:=public.set_t15_status(eid,'open',v);
 perform pg_temp.expect_t15_error(format('select public.save_t15_result(%L,%L,%L::jsonb,%s)',eid,'A1','{"score1":24,"score2":15,"innings1":30,"innings2":30,"high1":5,"high2":4}',v),'DEPENDENTS_EXIST');
 v:=public.save_t15_result(eid,'A1','{"score1":24,"score2":15,"innings1":30,"innings2":30,"high1":5,"high2":4}',v,true);
 state:=public.get_t15_result_event(eid);
 if (state->'results') ? 'HF1' or (state->'results') ? 'F' then raise exception 'Dependent results survived group correction';end if;
 if (select count(*) from public.result_event_history where event_id=eid)<20 then raise exception 'Missing audit history';end if;
 perform public.grant_t15_access(eid,'t15-editor@example.invalid');
end $$;
-- Manual creation is separate; sent updates refresh the existing event before entry.
do $$
declare invitation jsonb; eid uuid; frozen jsonb;
begin
 select snapshot||jsonb_build_object('sourceUrl','https://example.invalid/t15-send-test','eventId','t15-send-test') into invitation from public.result_events where source_url='https://example.invalid/t15-test';
 insert into public.calendar_invitation_drafts(source_url,invitation,updated_by) values('https://example.invalid/t15-send-test',invitation,'f3150000-0000-4000-8000-000000000003');
 if (select updated_by from public.calendar_invitation_drafts where source_url='https://example.invalid/t15-send-test')<>auth.uid() then raise exception 'Spoofed invitation owner accepted';end if;
 insert into public.calendar_club_reminders(id,event_id,event_date,reminder_date,days_before,title,link,status,result_invitation_snapshot) values('t15-send-test','t15-send-test',current_date,current_date,0,'Test','https://example.invalid/t15-send-test','open',invitation);
 eid:=public.create_t15_result_event(invitation);
 if eid is null then raise exception 'Manual creation failed';end if;
 update public.calendar_club_reminders set status='sent' where id='t15-send-test';
 select id,snapshot into eid,frozen from public.result_events where source_url='https://example.invalid/t15-send-test';
 if eid is null then raise exception 'Invitation send did not create T15 event';end if;
 if public.create_t15_result_event(invitation)<>eid then raise exception 'Invitation created duplicate';end if;
 update public.calendar_invitation_drafts d set invitation=jsonb_set(d.invitation,'{title}','"Changed draft"') where source_url='https://example.invalid/t15-send-test';
 update public.calendar_club_reminders set status='open',result_invitation_snapshot=(select d.invitation from public.calendar_invitation_drafts d where d.source_url='https://example.invalid/t15-send-test') where id='t15-send-test';update public.calendar_club_reminders set status='sent' where id='t15-send-test';
 if (select snapshot->>'title' from public.result_events where id=eid)<>'Changed draft' then raise exception 'Sent update not applied';end if;
end $$;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values('f3150000-0000-4000-8000-000000000004','t15-invited@example.invalid','{"result_only":true}','{}',now(),now());
do $$begin if exists(select 1 from public.user_roles where user_id='f3150000-0000-4000-8000-000000000004' and (calendar_access<>'hidden' or tournament_access<>'hidden' or match_access<>'hidden' or role<>'member')) then raise exception 'Invited account got unrelated access';end if;end $$;
-- An unassigned calendar editor still cannot see the private result event.
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.result_events where source_url='https://example.invalid/t15-test') then raise exception 'Unassigned user can read private event';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$declare eid uuid;begin
 select id into eid from public.result_events where source_url='https://example.invalid/t15-test';
 if eid is null or public.result_can_manage(eid) then raise exception 'Assigned editor rights incorrect';end if;
 perform public.get_t15_result_event(eid);
 perform pg_temp.expect_t15_error(format('select public.grant_t15_access(%L,%L)',eid,'t15-outsider@example.invalid'),'Turnierleitung');
 perform pg_temp.expect_t15_error(format('select public.set_t15_status(%L,%L,1)',eid,'completed'),'Turnierleitung');
 perform pg_temp.expect_t15_error(format('update public.result_events set title=%L where id=%L','bad',eid),'permission denied');
end $$;
reset role;
-- Equal points and GD: HS wins even with fewer balls. GD and points precede HS.
do $$declare r jsonb; rows jsonb;begin
 r:='{"A1":{"score1":10,"score2":5,"innings1":10,"innings2":10,"high1":2,"high2":2},"A2":{"score1":20,"score2":5,"innings1":20,"innings2":10,"high1":3,"high2":2}}';
 rows:=public.t15_group_stats(r,'A');
 if rows->0->>'seed'<>'4' or rows->1->>'seed'<>'1' or (rows->0->>'tied')::boolean then raise exception 'HS must break equal points/GD';end if;
 r:=jsonb_set(r,'{A1,high1}','4');rows:=public.t15_group_stats(r,'A');
 if rows->0->>'seed'<>'1' then raise exception 'Balls incorrectly precede HS';end if;
 r:=jsonb_set(r,'{A2,innings1}','10');rows:=public.t15_group_stats(r,'A');
 if rows->0->>'seed'<>'4' then raise exception 'GD must precede HS';end if;
 r:=jsonb_set(r,'{A1,score2}','10');r:=jsonb_set(r,'{A1,high2}','10');rows:=public.t15_group_stats(r,'A');
 if rows->0->>'seed'<>'4' then raise exception 'Match points must precede GD/HS';end if;
end $$;
-- Full equality stays a shared rank; former manual orders cannot release finals.
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000001',true);
do $$declare eid uuid;g jsonb;v integer;state jsonb;begin
 select id into eid from test_t15_ids;select version into v from public.result_events where id=eid;
 for g in select value from jsonb_array_elements(public.t15_group_pairs('A')||public.t15_group_pairs('B')) loop
  v:=public.save_t15_result(eid,g->>'key','{"score1":0,"score2":0,"innings1":30,"innings2":30,"high1":0,"high2":0}',v,true);
 end loop;
 state:=public.get_t15_result_event(eid);
 if exists(select 1 from jsonb_array_elements(state->'schedule') where value->>'stage'='final' and (value->>'ready')::boolean) then raise exception 'Unresolved ties released final round';end if;
 if state->'standings'->'A'->0->>'rank'<>'1' or state->'standings'->'A'->3->>'rank'<>'1' then raise exception 'Equal players must share their rank';end if;
 if exists(select 1 from jsonb_array_elements(public.t15_schedule(state->'results','{"A":[8,5,4,1],"B":[7,6,3,2]}')) where value->>'stage'='final' and (value->>'ready')::boolean) then raise exception 'Legacy manual order still releases finals';end if;
 perform public.revoke_t15_access(eid,'f3150000-0000-4000-8000-000000000002');
end $$;
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$begin if exists(select 1 from public.result_events where source_url='https://example.invalid/t15-test') then raise exception 'Revoked user still has access';end if;end $$;
reset role;
set local role anon;
select pg_temp.expect_t15_error('select * from public.result_events','permission denied');
select pg_temp.expect_t15_error('select public.get_t15_result_event(''00000000-0000-0000-0000-000000000000'')','permission denied');
reset role;
select 'PASS: T15 seeds, all 18 games, statistics, shared ranks, knockout winners, completion/reopening, dependent resets, audit trail, concurrency, editor/outsider/anonymous/revoked permissions' as result;
rollback;
