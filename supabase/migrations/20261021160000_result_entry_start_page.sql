begin;
-- Routing is based on server-side roles; the list contains only explicit assignments.
create function public.result_entry_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();only_results boolean;events jsonb;
begin
 if uid is null then raise exception 'Bitte anmelden.';end if;
 only_results:=not public.is_admin(uid) and (
  exists(select 1 from auth.users where id=uid and raw_user_meta_data->>'result_only'='true')
  or (exists(select 1 from public.result_event_members where user_id=uid)
   and not exists(select 1 from public.user_roles where user_id=uid and tournament_access='edit' and match_access='edit')
   and not public.has_calendar_admin_access(uid)));
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'event_date',e.event_date,'status',e.status,
 'mode',e.snapshot->>'selectedModeCode','location',e.snapshot->>'locationName') order by e.event_date desc,e.updated_at desc),'[]') into events
 from public.result_events e join public.result_event_members m on m.event_id=e.id where m.user_id=uid;
 return jsonb_build_object('result_only',only_results,'events',events);
end $$;
revoke all on function public.result_entry_context() from public,anon;
grant execute on function public.result_entry_context() to authenticated;
commit;
