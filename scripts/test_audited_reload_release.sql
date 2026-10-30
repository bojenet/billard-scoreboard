-- Transactional test: no tournament or invitation changes survive.
begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3150000-0000-4000-8000-000000000011','t15-reload-owner@example.invalid','{}','{}',now(),now()),
('f3150000-0000-4000-8000-000000000012','t15-reload-editor@example.invalid','{}','{}',now(),now());
create function pg_temp.expect_reload_error(statement text,fragment text) returns void language plpgsql as $$
begin
 begin execute statement;exception when others then if position(fragment in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected failure: %',fragment;
end $$;
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000011',true);
do $$declare invitation jsonb;eid uuid;v integer:=1;state jsonb;begin
 select jsonb_build_object('sourceUrl','https://example.invalid/t15-reload','selectedModeCode','T15','title','Before','date','2026-10-21','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i,'passNo','00'||i))) into invitation from generate_series(1,8) i;
 eid:=public.result_create_internal(invitation,auth.uid());
 if not (public.get_t15_result_event(eid)->>'can_reload')::boolean then raise exception 'Reload unavailable before capture';end if;
 invitation:=jsonb_set(invitation,'{title}','"After"');invitation:=jsonb_set(invitation,'{participants,0,name}','"Replacement"');
 v:=public.refresh_t15_event_data(eid,invitation,v);
 state:=public.get_t15_result_event(eid);
 if state->>'title'<>'After' or state->'snapshot'->'participants'->0->>'name'<>'Replacement' or state->>'version'<>'2' then raise exception 'Snapshot not refreshed';end if;
 perform pg_temp.expect_reload_error(format('select public.refresh_t15_event_data(%L,%L,1)',eid,invitation),'VERSION_CONFLICT');
 perform pg_temp.expect_reload_error(format('select public.refresh_t15_event_data(%L,%L,%s)',eid,jsonb_set(invitation,'{sourceUrl}','"https://example.invalid/other"'),v),'Quelle');
 perform pg_temp.expect_reload_error(format('select public.refresh_t15_event_data(%L,%L,%s)',eid,jsonb_set(invitation,'{participants}','[]'),v),'8 Teilnehmer');
 perform public.grant_t15_access(eid,'t15-reload-editor@example.invalid');
 perform set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000012',true);
 perform pg_temp.expect_reload_error(format('select public.refresh_t15_event_data(%L,%L,%s)',eid,invitation,v),'Turnierleitung');
 perform set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000011',true);
 v:=public.save_t15_result(eid,'A1','{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":20,"high2":10}',v);
 if (public.get_t15_result_event(eid)->>'can_reload')::boolean then raise exception 'Reload remains visible after capture';end if;
 perform pg_temp.expect_reload_error(format('select public.refresh_t15_event_data(%L,%L,%s)',eid,invitation,v),'ersten Ergebniserfassung');
 v:=public.save_t15_result(eid,'A1',null,v);
 perform pg_temp.expect_reload_error(format('select public.refresh_t15_event_data(%L,%L,%s)',eid,invitation,v),'ersten Ergebniserfassung');
 if (public.get_t15_result_event(eid)->>'can_reload')::boolean then raise exception 'Deleting result allowed reload';end if;
 insert into public.result_event_history(event_id,action,after_state) values(eid,'Neuladen nach Testeingaben freigegeben','{}');
 if not (public.get_t15_result_event(eid)->>'can_reload')::boolean then raise exception 'Release did not unlock reload';end if;
 v:=public.refresh_t15_event_data(eid,invitation,v);
 v:=public.save_t15_result(eid,'A1','{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":20,"high2":10}',v);
 if (public.get_t15_result_event(eid)->>'can_reload')::boolean then raise exception 'New capture after release must lock again';end if;
 if not exists(select 1 from public.result_event_history where event_id=eid and action='Turnierdaten neu aus ClubCloud geladen') then raise exception 'Missing reload audit';end if;
end $$;
select 'PASS: reload snapshot, manager-only access, version conflict, source lock, participant validation, first-result lock even after deletion, audit' as result;
rollback;
