begin;
create or replace function public.refresh_t15_event_data(p_id uuid,p_invitation jsonb,p_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;next_snapshot jsonb;
begin
 perform pg_advisory_xact_lock(823104);
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf Turnierdaten neu laden.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Bitte neu laden.';end if;
 if e.status<>'open' or e.results<>'{}'::jsonb or exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %') then
  raise exception 'Turnierdaten können nur vor der ersten Ergebniserfassung neu geladen werden.';
 end if;
 if exists(select 1 from public.tournament_operation_tables where event_id=p_id) then raise exception 'Vor dem Neuladen den Displaybetrieb beenden.';end if;
 if exists(select 1 from public.tournament_live_games where event_id=p_id and version>0) then raise exception 'Turnierdaten können nur vor der ersten Ergebniserfassung neu geladen werden.';end if;
 if p_invitation->>'sourceUrl' is distinct from e.source_url then raise exception 'Die ClubCloud-Quelle darf nicht geändert werden.';end if;
 next_snapshot:=public.result_validate_snapshot(p_invitation||jsonb_build_object('modeOverride',true,'rosterOverride',true,'tableIds',coalesce(e.snapshot->'tableIds','[]'::jsonb)));
 delete from public.tournament_live_games where event_id=p_id;
 update public.result_events set snapshot=next_snapshot,
 title=coalesce(nullif(trim(p_invitation->>'title'),''),e.title),event_date=coalesce(p_invitation->>'date',p_invitation->>'eventDate',e.event_date),
 group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),'Turnierdaten neu aus ClubCloud geladen',jsonb_build_object('snapshot',e.snapshot,'version',e.version),jsonb_build_object('snapshot',next_snapshot,'version',e.version+1));
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
 return to_jsonb(e)||jsonb_build_object('can_manage',public.result_can_manage(p_id),'can_delete',public.is_admin(auth.uid()),'can_reload',public.result_can_manage(p_id) and e.status='open' and e.results='{}'::jsonb and not exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %') and not exists(select 1 from public.tournament_operation_tables where event_id=p_id) and not exists(select 1 from public.tournament_live_games where event_id=p_id and version>0),'members',members,'schedule',coalesce(e.archived_ranking->'schedule',public.result_schedule(e.snapshot,e.results,e.group_order)),'standings',coalesce(e.archived_ranking->'standings',jsonb_build_object('A',public.result_group_stats(e.snapshot,e.results,'A'),'B',public.result_group_stats(e.snapshot,e.results,'B'),'C',public.result_group_stats(e.snapshot,e.results,'C'))));
end $$;
create or replace function public.result_sync_sent_invitation(p_invitation jsonb,p_owner uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;next_snapshot jsonb;src text:=coalesce(p_invitation->>'sourceUrl',p_invitation->>'link','');eid uuid;
begin
 -- Serialize creation and updates for concurrent sends of the same tournament.
 perform pg_advisory_xact_lock(hashtextextended(src,0));
 select * into e from public.result_events where source_url=src for update;
 if found then
  if coalesce((e.snapshot->>'rosterOverride')::boolean,false) then
   return jsonb_build_object('status','blocked','event_id',e.id,'message','Die Teilnehmer wurden direkt im Turnier angepasst. Einladungsupdates überschreiben diese Turnierdaten nicht.');
  end if;
  if e.status<>'open' or e.results<>'{}'::jsonb or exists(select 1 from public.result_event_history where event_id=e.id and action like 'Ergebnis %') then
   insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
   values(e.id,p_owner,'Einladungsupdate nicht übernommen: Erfassung begonnen',jsonb_build_object('snapshot',e.snapshot),jsonb_build_object('invitation',p_invitation));
   return jsonb_build_object('status','blocked','event_id',e.id,'message','Turnierdaten wurden nicht aktualisiert, weil die Ergebniserfassung bereits begonnen hat oder das Turnier abgeschlossen ist.');
  end if;
  next_snapshot:=public.result_validate_snapshot(case when coalesce((e.snapshot->>'modeOverride')::boolean,false) then p_invitation||jsonb_build_object('selectedModeCode',e.snapshot->>'selectedModeCode','modeOverride',true) else p_invitation end);
  update public.result_events set snapshot=next_snapshot,title=coalesce(nullif(p_invitation->>'title',''),e.title),event_date=coalesce(p_invitation->>'date',p_invitation->>'eventDate',e.event_date),group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=e.id;
  insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
  values(e.id,p_owner,'Turnierdaten aus versendeter Einladung aktualisiert',jsonb_build_object('snapshot',e.snapshot,'version',e.version),jsonb_build_object('snapshot',next_snapshot,'version',e.version+1));
  return jsonb_build_object('status','updated','event_id',e.id);
 end if;
 return jsonb_build_object('status','not_created');
end $$;
commit;
