begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3200000-0000-4000-8000-000000000001','capture-owner@example.invalid','{}','{}',now(),now()),
('f3200000-0000-4000-8000-000000000002','capture-editor@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3200000-0000-4000-8000-000000000001',true);
do $$declare inv jsonb;eid uuid;v integer:=1;s jsonb;r jsonb:='{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":20,"high2":10}';begin
 select jsonb_build_object('sourceUrl','https://example.invalid/capture-times','selectedModeCode','T3','title','Times','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into inv from generate_series(1,4) i;
 eid:=public.result_create_internal(inv,auth.uid());
 v:=public.save_t15_result(eid,'R1',r,v);
 update public.result_event_history set created_at='2026-10-31T10:00:59Z' where event_id=eid and action='Ergebnis R1';
 v:=public.save_t15_result(eid,'R1',r||'{"score1":90}',v);
 s:=public.get_t15_result_event(eid);
 if (s->'capture_times'->>'R1')::timestamptz<>'2026-10-31T10:00:59Z'::timestamptz then raise exception 'Correction replaced first capture time';end if;
 v:=public.save_t15_result(eid,'R2',r,v);
 if (public.get_t15_result_event(eid)->'capture_times'->>'R1')::timestamptz<>'2026-10-31T10:00:59Z'::timestamptz then raise exception 'Other match changed time';end if;
 v:=public.save_t15_result(eid,'R1',null,v);
 if public.result_capture_times(eid) ? 'R1' then raise exception 'Deleted result exported';end if;
 v:=public.save_t15_result(eid,'R1',r,v);
 update public.result_event_history set created_at='2026-10-31T11:30:12Z' where id=(select max(id) from public.result_event_history where event_id=eid and action='Ergebnis R1');
 if (public.result_capture_times(eid)->>'R1')::timestamptz<>'2026-10-31T11:30:12Z'::timestamptz then raise exception 'Re-entry reused old time';end if;
 perform public.grant_t15_access(eid,'capture-editor@example.invalid');
 perform set_config('request.jwt.claim.sub','f3200000-0000-4000-8000-000000000002',true);
 if public.get_t15_result_event(eid)->'capture_times'<>'{}'::jsonb then raise exception 'Editor export access expanded';end if;
end $$;
select 'PASS: first capture per current result, corrections preserve time, unrelated matches independent, deleted/re-entered results get fresh time, export metadata remains manager-only' result;
rollback;
