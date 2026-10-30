begin;
create or replace function public.change_result_mode(p_id uuid,p_mode text,p_version integer,p_reset boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;s jsonb;before_state jsonb;
begin
 perform pg_advisory_xact_lock(823104);
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Turnier wurde geändert. Bitte neu laden.';end if;
 if e.status<>'open' or e.archived_ranking is not null then raise exception 'Turnier zuerst für Korrekturen öffnen.';end if;
 if exists(select 1 from public.tournament_operation_tables where event_id=p_id) then raise exception 'Vor dem Moduswechsel den Displaybetrieb beenden.';end if;
 if public.result_mode(p_mode) is null then raise exception 'Dieser Modus wird nicht unterstützt.';end if;
 if (public.result_mode(p_mode)->>'count')::integer<>jsonb_array_length(e.snapshot->'participants') then raise exception 'Der Modus passt nicht zur Teilnehmerzahl.';end if;
 if e.snapshot->>'selectedModeCode'=p_mode then return e.version;end if;
 if not p_reset and (e.results<>'{}'::jsonb or exists(select 1 from public.tournament_live_games where event_id=p_id and version>0)) then raise exception 'RESET_REQUIRED: Beim Moduswechsel müssen Ergebnisse und Live-Spielstände zurückgesetzt werden.';end if;
 before_state:=jsonb_build_object('snapshot',e.snapshot,'results',e.results,'group_order',e.group_order,'version',e.version);
 s:=public.result_validate_snapshot(e.snapshot||jsonb_build_object('selectedModeCode',p_mode,'modeOverride',true));
 delete from public.tournament_live_games where event_id=p_id;
 update public.result_events set snapshot=s,results='{}',group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),'Turniermodus unabhängig von Einladung geändert',before_state,jsonb_build_object('snapshot',s,'results','{}'::jsonb,'version',e.version+1));
 return e.version+1;
end $$;
create or replace function public.get_t15_result_event(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; members jsonb:='[]';
begin
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 select * into strict e from public.result_events where id=p_id;
 if public.result_can_manage(p_id) then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email) order by u.email),'[]') into members from public.result_event_members m join auth.users u on u.id=m.user_id where m.event_id=p_id;
 end if;
 return to_jsonb(e)||jsonb_build_object('can_change_mode',public.result_can_access(p_id),'can_manage',public.result_can_manage(p_id),'can_delete',public.is_admin(auth.uid()),'can_reload',public.result_can_manage(p_id) and e.status='open' and e.results='{}'::jsonb and not public.result_capture_since_reload_release(p_id) and not exists(select 1 from public.tournament_operation_tables where event_id=p_id) and not exists(select 1 from public.tournament_live_games where event_id=p_id and version>0),'members',members,'schedule',coalesce(e.archived_ranking->'schedule',public.result_schedule(e.snapshot,e.results,e.group_order)),'standings',coalesce(e.archived_ranking->'standings',jsonb_build_object('A',public.result_group_stats(e.snapshot,e.results,'A'),'B',public.result_group_stats(e.snapshot,e.results,'B'),'C',public.result_group_stats(e.snapshot,e.results,'C'))));
end $$;
commit;
