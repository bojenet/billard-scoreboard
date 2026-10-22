-- All test data and function changes are rolled back by this test.
begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values('f3150000-0000-4000-8000-000000000021','result-modes@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000021',true);
do $$declare code text;cfg jsonb;n integer;expected integer;invitation jsonb;eid uuid;v integer;schedule jsonb;g jsonb;state jsonb;r jsonb;group_count integer;pair_count integer;begin
 foreach code in array array['T3','T4','T5','T7','T8','T11','T12','T10','T15'] loop
  cfg:=public.result_mode(code);n:=(cfg->>'count')::integer;expected:=case when code='T10' then 14 when code='T15' then 18 else n*(n-1)/2 end;
  select jsonb_build_object('sourceUrl','https://example.invalid/results-mode-'||code,'selectedModeCode',code,'enableResultEntry',true,'title',code||' Test','date','2026-10-21','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i,'passNo','00'||i))) into invitation from generate_series(1,n) i;
  insert into public.calendar_invitation_drafts(source_url,invitation,updated_by) values(invitation->>'sourceUrl',invitation,auth.uid());
  insert into public.calendar_club_reminders(id,event_id,event_date,reminder_date,days_before,title,link,status,result_invitation_snapshot)
  values('mode-test-'||code,'mode-test-'||code,current_date,current_date,0,code,invitation->>'sourceUrl','sent',invitation);
  select id into eid from public.result_events where source_url=invitation->>'sourceUrl';
  if eid is not null then raise exception '%: sending must not create result event',code;end if;
  eid:=public.create_t15_result_event(invitation);
  if public.result_create_internal(invitation,auth.uid())<>eid then raise exception 'Duplicate event';end if;v:=1;
  -- The same mode can reload its correct roster before first capture.
  v:=public.refresh_t15_event_data(eid,invitation,v);
  state:=public.get_t15_result_event(eid);schedule:=state->'schedule';
  if jsonb_array_length(schedule)<>expected then raise exception '%: expected % games, got %',code,expected,jsonb_array_length(schedule);end if;
  if jsonb_array_length(state->'standings'->'A')<>jsonb_array_length(cfg->'A') or jsonb_array_length(state->'standings'->'B')<>jsonb_array_length(coalesce(cfg->'B','[]')) then raise exception '%: wrong group sizes',code;end if;
  select count(*),count(distinct least((value->>'seed1')::integer,(value->>'seed2')::integer)||'-'||greatest((value->>'seed1')::integer,(value->>'seed2')::integer)) into group_count,pair_count from jsonb_array_elements(schedule) where value->>'stage'<>'final';
  if group_count<>pair_count then raise exception '%: duplicate pair',code;end if;
  for g in select value from jsonb_array_elements(schedule) where value->>'stage'<>'final' loop
   if (g->>'seed1')::integer not between 1 and n or (g->>'seed2')::integer not between 1 and n or g->>'seed1'=g->>'seed2' then raise exception '%: invalid seed',code;end if;
   r:=jsonb_build_object('score1',case when (g->>'seed1')::integer<(g->>'seed2')::integer then 100 else 50 end,'score2',case when (g->>'seed1')::integer<(g->>'seed2')::integer then 50 else 100 end,'innings1',20,'innings2',20,'high1',10,'high2',8);
   v:=public.save_t15_result(eid,g->>'key',r,v);
  end loop;
  state:=public.get_t15_result_event(eid);
  if cfg->>'kind'='roundRobin' then
   if state->'standings'->'A'->0->>'seed'<>'1' or (state->'standings'->'A'->0->>'played')::integer<>n-1 or (state->'standings'->'A'->0->>'points')::integer<>2*(n-1) then raise exception '%: wrong RR standings',code;end if;
   if exists(select 1 from jsonb_array_elements(state->'standings'->'A') where (value->>'played')::integer<>n-1) then raise exception '%: player not scheduled n-1 times',code;end if;
  else
   if exists(select 1 from jsonb_array_elements(state->'schedule') where value->>'key' in ('HF1','HF2','P5') and not (value->>'ready')::boolean) then raise exception '%: knockout blocked',code;end if;
   if code='T10' then
    select value into g from jsonb_array_elements(state->'schedule') where value->>'key'='HF1';
    if g->>'seed1'<>'1' or g->>'seed2'<>'3' then raise exception 'T10: wrong crossover';end if;
    if state->'standings'->'B'->3->>'seed'<>'7' then raise exception 'T10: wrong automatic seventh';end if;
    if exists(select 1 from jsonb_array_elements(state->'schedule') where value->>'key'='P7') then raise exception 'T10: phantom P7 match';end if;
   end if;
    foreach r in array array['{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":10,"high2":8}'::jsonb] loop
     v:=public.save_t15_result(eid,'HF1',r,v);v:=public.save_t15_result(eid,'HF2',r,v);v:=public.save_t15_result(eid,'P5',r,v);v:=public.save_t15_result(eid,'P3',r,v);v:=public.save_t15_result(eid,'F',r,v);
     if n=8 then v:=public.save_t15_result(eid,'P7',r,v);end if;
    end loop;
  end if;
  v:=public.set_t15_status(eid,'completed',v);state:=public.get_t15_result_event(eid);
  if state->>'status'<>'completed' or (select count(*) from jsonb_object_keys(state->'results'))<>expected then raise exception '%: completion failed',code;end if;
 end loop;
 -- Round-robin equality is a shared final rank, not a knockout blocker.
 invitation:=jsonb_set(invitation,'{selectedModeCode}','"T3"');invitation:=jsonb_set(invitation,'{participants}',(invitation->'participants')-7-6-5-4);
 r:='{}';
 for g in select value from jsonb_array_elements(public.result_group_pairs(invitation,'A')) loop r:=r||jsonb_build_object(g->>'key','{"score1":0,"score2":0,"innings1":20,"innings2":20,"high1":0,"high2":0}'::jsonb);end loop;
 if exists(select 1 from jsonb_array_elements(public.result_group_stats(invitation,r,'A')) where value->>'rank'<>'1' or not (value->>'tied')::boolean) then raise exception 'RR equality must share rank';end if;
end $$;
select 'PASS: all 9 supported mode codes, exact schedules, unique pairs, n-1 matches per RR player, reload, PP/GD/HS standings, T10 crossover/automatic seventh, full completion and shared ranks' as result;
rollback;
