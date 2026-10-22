begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3150000-0000-4000-8000-000000000051','draft-update-owner@example.invalid','{}','{}',now(),now()),
('f3150000-0000-4000-8000-000000000052','draft-update-editor@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000051',true);
do $$declare inv jsonb;eid uuid;v integer;begin
 select jsonb_build_object('sourceUrl','https://example.invalid/update-draft','selectedModeCode','T3','title','Draft tournament','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into inv from generate_series(1,4) i;
 eid:=public.create_t15_result_event(inv);perform public.grant_t15_access(eid,'draft-update-editor@example.invalid');
 inv:=inv||jsonb_build_object('selectedModeCode','T4','participants',inv->'participants'||'[{"number":5,"name":"Neuer Spieler"}]'::jsonb);
 v:=public.update_result_from_invitation(eid,inv,1);
 if jsonb_array_length(public.get_t15_result_event(eid)->'schedule')<>10 or jsonb_array_length((select snapshot->'participants' from public.result_events where id=eid))<>5 then raise exception 'Adding player/mode not applied';end if;
 inv:=inv||jsonb_build_object('selectedModeCode','T3','participants',(inv->'participants')-4);
 v:=public.update_result_from_invitation(eid,inv,v);
 if jsonb_array_length(public.get_t15_result_event(eid)->'schedule')<>6 then raise exception 'Removing player/mode not applied';end if;
 if not exists(select 1 from public.result_event_members where event_id=eid and user_id='f3150000-0000-4000-8000-000000000052') then raise exception 'Assigned access lost';end if;
 begin perform public.update_result_from_invitation(eid,inv,1);raise exception 'Expected version conflict';exception when others then if position('VERSION_CONFLICT' in sqlerrm)=0 then raise;end if;end;
 perform set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000052',true);
 begin perform public.update_result_from_invitation(eid,inv,v);raise exception 'Expected permission failure';exception when others then if position('Turnierleitung' in sqlerrm)=0 then raise;end if;end;
 perform set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000051',true);
 v:=public.save_t15_result(eid,'R1','{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":20,"high2":10}',v);
 v:=public.save_t15_result(eid,'R1',null,v);
 begin perform public.update_result_from_invitation(eid,inv,v);raise exception 'Expected first-entry lock';exception when others then if position('ersten Ergebniserfassung' in sqlerrm)=0 then raise;end if;end;
end $$;
select 'PASS: adding/removing players switches mode and schedule without email, access retained, optimistic concurrency, manager-only and first-entry lock after result deletion' as result;
rollback;
