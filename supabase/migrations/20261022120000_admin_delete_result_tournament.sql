begin;
create function public.delete_result_tournament(p_id uuid,p_version integer,p_confirmation text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Nur Administratoren dürfen Turniere löschen.';end if;
 select * into strict e from public.result_events where id=p_id for update;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Das Turnier wurde inzwischen geändert. Bitte die Seite neu laden.';end if;
 if p_confirmation is distinct from e.title then raise exception 'Der eingegebene Turniername stimmt nicht überein.';end if;
 -- Foreign keys cascade to result_event_members and result_event_history.
 delete from public.result_events where id=p_id;
end $$;
revoke all on function public.delete_result_tournament(uuid,integer,text) from public,anon;
grant execute on function public.delete_result_tournament(uuid,integer,text) to authenticated;

create or replace function public.get_t15_result_event(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; members jsonb:='[]';
begin
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 select * into strict e from public.result_events where id=p_id;
 if public.result_can_manage(p_id) then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email) order by u.email),'[]') into members from public.result_event_members m join auth.users u on u.id=m.user_id where m.event_id=p_id;
 end if;
 return to_jsonb(e)||jsonb_build_object('can_manage',public.result_can_manage(p_id),'can_delete',public.is_admin(auth.uid()),'can_reload',public.result_can_manage(p_id) and e.status='open' and e.results='{}'::jsonb and not exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %'),'members',members,'schedule',coalesce(e.archived_ranking->'schedule',public.result_schedule(e.snapshot,e.results,e.group_order)),'standings',coalesce(e.archived_ranking->'standings',jsonb_build_object('A',public.result_group_stats(e.snapshot,e.results,'A'),'B',public.result_group_stats(e.snapshot,e.results,'B'))));
end $$;




commit;
