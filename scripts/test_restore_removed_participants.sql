begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3210000-0000-4000-8000-000000000001','restore-owner@example.invalid','{}','{}',now(),now()),
('f3210000-0000-4000-8000-000000000002','restore-editor@example.invalid','{}','{}',now(),now()),
('f3210000-0000-4000-8000-000000000003','restore-outsider@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3210000-0000-4000-8000-000000000001',true);
do $$declare inv jsonb;eid uuid;v integer:=1;s jsonb;rid uuid;begin
 select jsonb_build_object('sourceUrl','https://example.invalid/restore-test','selectedModeCode','T19','title','Restore test','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i,'club','Verein '||i,'passNo','Pass '||i))) into inv from generate_series(1,10) i;
 eid:=public.result_create_internal(inv,auth.uid());perform public.grant_t15_access(eid,'restore-editor@example.invalid');
 perform set_config('request.jwt.claim.sub','f3210000-0000-4000-8000-000000000002',true);
 v:=public.remove_result_participants(eid,array[3],'T16b',v);s:=public.get_t15_result_event(eid);
 if jsonb_array_length(s->'snapshot'->'removedParticipants')<>1 or s->'snapshot'->'removedParticipants'->0->>'name'<>'Spieler 3' then raise exception 'Removed player was not retained';end if;
 rid:=(s->'snapshot'->'removedParticipants'->0->>'attendance_id')::uuid;
 begin perform public.adjust_result_participants(eid,'{}',array[gen_random_uuid()],'T19',v);raise exception 'Arbitrary player accepted';exception when others then if position('Nur zuvor entfernte' in sqlerrm)=0 then raise;end if;end;
 begin perform public.adjust_result_participants(eid,'{}',array[rid],'T16b',v);raise exception 'Wrong count accepted';exception when others then if position('Teilnehmerzahl' in sqlerrm)=0 then raise;end if;end;
 perform set_config('request.jwt.claim.sub','f3210000-0000-4000-8000-000000000003',true);
 begin perform public.adjust_result_participants(eid,'{}',array[rid],'T19',v);raise exception 'Outsider accepted';exception when others then if position('Kein Zugriff' in sqlerrm)=0 then raise;end if;end;
 perform set_config('request.jwt.claim.sub','f3210000-0000-4000-8000-000000000002',true);
 v:=public.adjust_result_participants(eid,'{}',array[rid],'T19',v);s:=public.get_t15_result_event(eid);
 if jsonb_array_length(s->'snapshot'->'participants')<>10 or s->'snapshot'->'participants'->2->>'name'<>'Spieler 3' or s->'snapshot'->'participants'->2->>'passNo'<>'Pass 3' or jsonb_array_length(s->'snapshot'->'removedParticipants')<>0 then raise exception 'Restore order or metadata failed';end if;
 begin perform public.adjust_result_participants(eid,'{}',array[rid],'T19',v);raise exception 'Repeated restore duplicated player';exception when others then if position('Nur zuvor entfernte' in sqlerrm)=0 then raise;end if;end;
 v:=public.remove_result_participants(eid,array[3],'T16b',v);s:=public.get_t15_result_event(eid);
 if s->'snapshot'->'removedParticipants'->0->>'attendance_id'<>rid::text then raise exception 'Player identity changed';end if;
 v:=public.save_t15_result(eid,'A1','{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":20,"high2":10}',v);
 begin perform public.adjust_result_participants(eid,'{}',array[rid],'T19',v);raise exception 'Results reset silently';exception when others then if position('RESET_REQUIRED' in sqlerrm)=0 then raise;end if;end;
 v:=public.adjust_result_participants(eid,array[1],array[rid],'T16b',v,true);s:=public.get_t15_result_event(eid);
 if s->'snapshot'->'participants'->1->>'name'<>'Spieler 3' or s->'snapshot'->'removedParticipants'->0->>'name'<>'Spieler 1' then raise exception 'Combined removal/restore failed';end if;
 if not exists(select 1 from public.result_event_history where event_id=eid and actor_id=auth.uid() and action='Entfernte Spieler wiederhergestellt und Teilnehmerliste angepasst') then raise exception 'Restore audit missing';end if;
end $$;
select 'PASS: persisted removed players, invited restore after reload, original seed/order/metadata, stable identity, combined removal/restore, no arbitrary or duplicate players, outsider/count/result-reset guards and audit' result;
rollback;
