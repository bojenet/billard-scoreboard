begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3200000-0000-4000-8000-000000000001','absent-owner@example.invalid','{}','{}',now(),now()),
('f3200000-0000-4000-8000-000000000002','absent-editor@example.invalid','{}','{}',now(),now()),
('f3200000-0000-4000-8000-000000000003','absent-outsider@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3200000-0000-4000-8000-000000000001',true);
do $$declare inv jsonb;eid uuid;v integer:=1;s jsonb;outcome jsonb;begin
 select jsonb_build_object('sourceUrl','https://example.invalid/absent-test','selectedModeCode','T19','title','Attendance test','playingTargetPoints','100','playingTargetInnings','20','tableIds',jsonb_build_array('tb01','tb02'),'participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i,'club','Verein '||i,'passNo','Pass '||i))) into inv from generate_series(1,10) i;
 insert into public.calendar_invitation_drafts(source_url,invitation,updated_by) values(inv->>'sourceUrl',inv,auth.uid());
 eid:=public.result_create_internal(inv,auth.uid());
 perform public.grant_t15_access(eid,'absent-editor@example.invalid');
 perform set_config('request.jwt.claim.sub','f3200000-0000-4000-8000-000000000003',true);
 begin perform public.remove_result_participants(eid,array[3],'T16b',v);raise exception 'Outsider allowed';exception when others then if position('Kein Zugriff' in sqlerrm)=0 then raise;end if;end;
 perform set_config('request.jwt.claim.sub','f3200000-0000-4000-8000-000000000002',true);
 if public.result_can_manage(eid) then raise exception 'Invited editor unexpectedly has management rights';end if;
 begin perform public.remove_result_participants(eid,array[3],'T16b',v-1);raise exception 'Stale edit allowed';exception when others then if position('VERSION_CONFLICT' in sqlerrm)=0 then raise;end if;end;
 begin perform public.remove_result_participants(eid,array[3],'T19',v);raise exception 'Wrong count allowed';exception when others then if position('Teilnehmerzahl' in sqlerrm)=0 then raise;end if;end;
 begin perform public.remove_result_participants(eid,array[11],'T16b',v);raise exception 'Missing seed allowed';exception when others then if position('nicht mehr' in sqlerrm)=0 then raise;end if;end;
 begin perform public.remove_result_participants(eid,array[]::integer[],'T16b',v);raise exception 'Empty removal allowed';exception when others then if position('mindestens' in sqlerrm)=0 then raise;end if;end;
 begin perform public.remove_result_participants(eid,array[null]::integer[],'T16b',v);raise exception 'Null removal allowed';exception when others then if position('mindestens' in sqlerrm)=0 then raise;end if;end;
 begin
  update public.tournament_operation_tables set event_id=eid where id='tb01';
  perform public.remove_result_participants(eid,array[3],'T16b',v);
  raise exception 'Active display roster changed';
 exception when others then if position('Displaybetrieb' in sqlerrm)=0 then raise;end if;end;
 v:=public.save_t15_result(eid,'A1','{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":20,"high2":10}',v);
 begin perform public.remove_result_participants(eid,array[3],'T16b',v);raise exception 'Result erased without confirmation';exception when others then if position('RESET_REQUIRED' in sqlerrm)=0 then raise;end if;end;
 begin perform public.remove_result_participants(eid,array[3],'T16b',v,null);raise exception 'Null bypassed reset confirmation';exception when others then if position('RESET_REQUIRED' in sqlerrm)=0 then raise;end if;end;
 if (select results from public.result_events where id=eid)='{}'::jsonb then raise exception 'Failed removal mutated results';end if;
 v:=public.remove_result_participants(eid,array[3],'T16b',v,true);s:=public.get_t15_result_event(eid);
 if jsonb_array_length(s->'snapshot'->'participants')<>9 or s->'snapshot'->>'selectedModeCode'<>'T16b' or jsonb_array_length(s->'standings'->'C')<>3 or s->'results'<>'{}'::jsonb then raise exception 'Attendance update failed';end if;
 if s->'snapshot'->'participants'->2->>'name'<>'Spieler 4' or s->'snapshot'->'participants'->2->>'seed'<>'3' or s->'snapshot'->'participants'->2->>'number'<>'3' or s->'snapshot'->'participants'->2->>'passNo'<>'Pass 4' then raise exception 'Remaining order, metadata or seeds changed';end if;
 if s->'snapshot'->>'playingTargetPoints'<>'100' or s->'snapshot'->'tableIds'<>'["tb01","tb02"]' then raise exception 'Targets or table configuration changed';end if;
 if (select invitation from public.calendar_invitation_drafts where source_url=inv->>'sourceUrl')<>inv then raise exception 'Invitation changed';end if;
 if not exists(select 1 from public.result_event_history where event_id=eid and actor_id=auth.uid() and action='Nicht erschienene Spieler entfernt und Turniermodus angepasst' and before_state->'results' ? 'A1') then raise exception 'Missing actor or previous results in audit';end if;
 outcome:=public.result_sync_sent_invitation(inv,auth.uid());
 if outcome->>'status'<>'blocked' then raise exception 'Invitation update overwrote attendance';end if;
 insert into public.tournament_live_games(event_id,game_key,state,version) values(eid,'A1',public.tournament_initial_score(),1);
 begin perform public.remove_result_participants(eid,array[1,2],'T10',v);raise exception 'Live score erased without confirmation';exception when others then if position('RESET_REQUIRED' in sqlerrm)=0 then raise;end if;end;
 v:=public.remove_result_participants(eid,array[1,2],'T10',v,true);s:=public.get_t15_result_event(eid);
 if jsonb_array_length(s->'snapshot'->'participants')<>7 or exists(select 1 from public.tournament_live_games where event_id=eid) then raise exception 'Multiple removal or live reset failed';end if;
 update public.result_events set status='completed' where id=eid;
 begin perform public.remove_result_participants(eid,array[1],'T7',v);raise exception 'Completed event edited';exception when others then if position('für Korrekturen öffnen' in sqlerrm)=0 then raise;end if;end;
 if has_function_privilege('anon','public.remove_result_participants(uuid,integer[],text,integer,boolean)','EXECUTE') then raise exception 'Anonymous execution allowed';end if;
end $$;
select 'PASS: invited attendance changes, outsider/anonymous rejection, count/seed/version/closed guards, explicit results/live reset, multiple removal, preserved metadata/order/targets/invitation, fresh schedule and audit' result;
rollback;
