begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3150000-0000-4000-8000-000000000031','result-context-owner@example.invalid','{}','{}',now(),now()),
('f3150000-0000-4000-8000-000000000032','result-context-assigned@example.invalid','{}','{}',now(),now()),
('f3150000-0000-4000-8000-000000000033','result-context-invited@example.invalid','{"result_only":true}','{}',now(),now());
update public.user_roles set tournament_access='read',calendar_access='hidden',role='member' where user_id='f3150000-0000-4000-8000-000000000032';
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000031',true);
do $$declare invitation jsonb;eid uuid;begin
 select jsonb_build_object('sourceUrl','https://example.invalid/context-assigned','selectedModeCode','T3','title','Invited event','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into invitation from generate_series(1,4) i;
 eid:=public.result_create_internal(invitation,auth.uid());perform public.grant_t15_access(eid,'result-context-assigned@example.invalid');
 perform public.result_create_internal(invitation||jsonb_build_object('sourceUrl','https://example.invalid/context-private','title','Unassigned event'),auth.uid());
end $$;
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000032',true);
set local role authenticated;
do $$declare context jsonb:=public.result_entry_context();begin
 if not (context->>'result_only')::boolean or jsonb_array_length(context->'events')<>1 or context->'events'->0->>'title'<>'Invited event' then raise exception 'Assigned read-only account has wrong start/list: %',context;end if;
end $$;
reset role;
update public.user_roles set tournament_access='edit',match_access='edit',calendar_access='edit' where user_id='f3150000-0000-4000-8000-000000000032';
do $$begin if not (public.result_entry_context()->>'result_only')::boolean then raise exception 'Explicit assignment must override generic module edit permissions';end if;end $$;
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000033',true);
do $$declare context jsonb:=public.result_entry_context();begin
 if not (context->>'result_only')::boolean or context->'events'<>'[]' then raise exception 'Invited account without assignments should get empty list';end if;
end $$;
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000031',true);
do $$declare context jsonb:=public.result_entry_context();begin
 if (context->>'result_only')::boolean or not (context->>'can_manage')::boolean then raise exception 'Tournament manager incorrectly restricted';end if;
end $$;
update public.user_roles set role='admin' where user_id='f3150000-0000-4000-8000-000000000033';
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000033',true);
do $$begin if (public.result_entry_context()->>'result_only')::boolean then raise exception 'Admin incorrectly restricted';end if;end $$;
set local role anon;
do $$begin
 begin perform public.result_entry_context();exception when insufficient_privilege then return;end;
 raise exception 'Anonymous context access allowed';
end $$;
reset role;
select 'PASS: result-only/read-only routing, strictly assigned list, no unrelated events, empty revoked/new invitations, managers/admins unaffected, anonymous denied' as result;
rollback;
