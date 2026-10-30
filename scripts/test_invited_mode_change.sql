begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3190000-0000-4000-8000-000000000001','mode-owner@example.invalid','{}','{}',now(),now()),
('f3190000-0000-4000-8000-000000000002','mode-editor@example.invalid','{}','{}',now(),now()),
('f3190000-0000-4000-8000-000000000003','mode-outsider@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3190000-0000-4000-8000-000000000001',true);
do $$declare inv jsonb;eid uuid;v integer:=1;s jsonb;begin
 select jsonb_build_object('sourceUrl','https://example.invalid/invited-mode','selectedModeCode','T16','title','Access test','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into inv from generate_series(1,9) i;
 eid:=public.result_create_internal(inv,auth.uid());
 perform public.grant_t15_access(eid,'mode-editor@example.invalid');
 perform set_config('request.jwt.claim.sub','f3190000-0000-4000-8000-000000000003',true);
 begin perform public.change_result_mode(eid,'T16b',v);raise exception 'Outsider allowed';exception when others then if position('Kein Zugriff' in sqlerrm)=0 then raise;end if;end;
 perform set_config('request.jwt.claim.sub','f3190000-0000-4000-8000-000000000002',true);
 s:=public.get_t15_result_event(eid);
 if not(s->>'can_change_mode')::boolean or (s->>'can_manage')::boolean or (s->>'can_reload')::boolean then raise exception 'Wrong editor rights';end if;
 v:=public.change_result_mode(eid,'T16b',v);s:=public.get_t15_result_event(eid);
 if s->'snapshot'->>'selectedModeCode'<>'T16b' or jsonb_array_length(s->'standings'->'C')<>3 then raise exception 'Invited mode change failed';end if;
 if not exists(select 1 from public.result_event_history where event_id=eid and action='Turniermodus unabhängig von Einladung geändert' and actor_id=auth.uid()) then raise exception 'Missing editor audit';end if;
 v:=public.save_t15_result(eid,'A1','{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":20,"high2":10}',v);
 begin perform public.change_result_mode(eid,'T16',v);raise exception 'Reset without confirmation';exception when others then if position('RESET_REQUIRED' in sqlerrm)=0 then raise;end if;end;
 v:=public.change_result_mode(eid,'T16',v,true);
 update public.result_events set status='completed' where id=eid;
 begin perform public.change_result_mode(eid,'T16b',v);raise exception 'Closed tournament changed';exception when others then if position('für Korrekturen öffnen' in sqlerrm)=0 then raise;end if;end;
end $$;
select 'PASS: invited editor can change mode, outsiders denied, management and reload permissions unchanged, explicit result-reset confirmation, actor audit, completed guard' result;
rollback;
