begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3150000-0000-4000-8000-000000000061','delete-result-owner@example.invalid','{}','{}',now(),now()),
('f3150000-0000-4000-8000-000000000062','delete-result-editor@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000061',true);
do $$declare inv jsonb;eid uuid;begin
 select jsonb_build_object('sourceUrl','https://example.invalid/admin-delete','selectedModeCode','T3','title','Delete test','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into inv from generate_series(1,4) i;
 eid:=public.create_t15_result_event(inv);perform public.grant_t15_access(eid,'delete-result-editor@example.invalid');
 begin perform public.delete_result_tournament(eid,1,'Delete test');raise exception 'Non-admin owner deleted tournament';exception when others then if position('Nur Administratoren' in sqlerrm)=0 then raise;end if;end;
 if (public.get_t15_result_event(eid)->>'can_delete')::boolean then raise exception 'Delete button exposed to non-admin owner';end if;
 update public.user_roles set role='admin' where user_id=auth.uid();
 if not (public.get_t15_result_event(eid)->>'can_delete')::boolean then raise exception 'Delete unavailable to admin';end if;
 begin perform public.delete_result_tournament(eid,0,'Delete test');raise exception 'Stale version deleted tournament';exception when others then if position('VERSION_CONFLICT' in sqlerrm)=0 then raise;end if;end;
 begin perform public.delete_result_tournament(eid,1,'Wrong name');raise exception 'Wrong title deleted tournament';exception when others then if position('Turniername' in sqlerrm)=0 then raise;end if;end;
 insert into public.result_event_history(event_id,actor_id,action,after_state) values(eid,auth.uid(),'Test history','{}');
 perform public.delete_result_tournament(eid,1,'Delete test');
 if exists(select 1 from public.result_events where id=eid) or exists(select 1 from public.result_event_members where event_id=eid) or exists(select 1 from public.result_event_history where event_id=eid) then raise exception 'Delete left related records';end if;
end $$;
set local role anon;
do $$begin
 begin perform public.delete_result_tournament('00000000-0000-0000-0000-000000000000',1,'');exception when insufficient_privilege then return;end;
 raise exception 'Anonymous deletion endpoint allowed';
end $$;
reset role;
select 'PASS: admin-only deletion/button flag, non-admin owner denied, confirmation title, version check, cascading result/access/history deletion, anonymous denied' as result;
rollback;
