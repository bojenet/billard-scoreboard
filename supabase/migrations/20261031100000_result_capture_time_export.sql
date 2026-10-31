begin;
create function public.result_capture_times(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(k,(select min(h.created_at) from public.result_event_history h
 where h.event_id=p_id and h.action='Ergebnis '||k and h.after_state->'results' ? k
 and h.id>coalesce((select max(d.id) from public.result_event_history d where d.event_id=p_id and d.after_state ? 'results' and not(d.after_state->'results' ? k)),0))),'{}'::jsonb)
 from jsonb_object_keys((select results from public.result_events where id=p_id)) k;
$$;
revoke all on function public.result_capture_times(uuid) from public,anon,authenticated;
create or replace function public.get_t15_result_event(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; members jsonb:='[]';
begin
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 select * into strict e from public.result_events where id=p_id;
 if public.result_can_manage(p_id) then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email) order by u.email),'[]') into members from public.result_event_members m join auth.users u on u.id=m.user_id where m.event_id=p_id;
 end if;
 return to_jsonb(e)||jsonb_build_object('capture_times',case when public.result_can_manage(p_id) then public.result_capture_times(p_id) else '{}'::jsonb end,'can_change_mode',public.result_can_access(p_id),'can_manage',public.result_can_manage(p_id),'can_delete',public.is_admin(auth.uid()),'can_reload',public.result_can_manage(p_id) and e.status='open' and e.results='{}'::jsonb and not public.result_capture_since_reload_release(p_id) and not exists(select 1 from public.tournament_operation_tables where event_id=p_id) and not exists(select 1 from public.tournament_live_games where event_id=p_id and version>0),'members',members,'schedule',coalesce(e.archived_ranking->'schedule',public.result_schedule(e.snapshot,e.results,e.group_order)),'standings',coalesce(e.archived_ranking->'standings',jsonb_build_object('A',public.result_group_stats(e.snapshot,e.results,'A'),'B',public.result_group_stats(e.snapshot,e.results,'B'),'C',public.result_group_stats(e.snapshot,e.results,'C'))));
end $$;
commit;
