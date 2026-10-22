begin;
-- Sending never creates a tournament. It may update an existing, unstarted one.
create or replace function public.result_sync_sent_invitation(p_invitation jsonb,p_owner uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;next_snapshot jsonb;src text:=coalesce(p_invitation->>'sourceUrl',p_invitation->>'link','');eid uuid;
begin
 -- Serialize creation and updates for concurrent sends of the same tournament.
 perform pg_advisory_xact_lock(hashtextextended(src,0));
 select * into e from public.result_events where source_url=src for update;
 if found then
  if e.status<>'open' or e.results<>'{}'::jsonb or exists(select 1 from public.result_event_history where event_id=e.id and action like 'Ergebnis %') then
   insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
   values(e.id,p_owner,'Einladungsupdate nicht übernommen: Erfassung begonnen',jsonb_build_object('snapshot',e.snapshot),jsonb_build_object('invitation',p_invitation));
   return jsonb_build_object('status','blocked','event_id',e.id,'message','Turnierdaten wurden nicht aktualisiert, weil die Ergebniserfassung bereits begonnen hat oder das Turnier abgeschlossen ist.');
  end if;
  next_snapshot:=public.result_validate_snapshot(p_invitation);
  update public.result_events set snapshot=next_snapshot,title=coalesce(nullif(p_invitation->>'title',''),e.title),event_date=coalesce(p_invitation->>'date',p_invitation->>'eventDate',e.event_date),group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=e.id;
  insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
  values(e.id,p_owner,'Turnierdaten aus versendeter Einladung aktualisiert',jsonb_build_object('snapshot',e.snapshot,'version',e.version),jsonb_build_object('snapshot',next_snapshot,'version',e.version+1));
  return jsonb_build_object('status','updated','event_id',e.id);
 end if;
 return jsonb_build_object('status','not_created');
end $$;
create or replace function public.result_after_invitation_sent() returns trigger language plpgsql security definer set search_path='' as $$
declare draft public.calendar_invitation_drafts%rowtype;invitation jsonb;outcome jsonb;
begin
 if new.status='sent' and (tg_op='INSERT' or old.status is distinct from 'sent') then
  select * into draft from public.calendar_invitation_drafts where source_url=new.link;
  invitation:=new.result_invitation_snapshot;
  if invitation is not null and draft.updated_by is not null then
   begin
    if coalesce(invitation->>'sourceUrl',invitation->>'link','') is distinct from new.link then raise exception 'Die Turnierquelle der Einladung stimmt nicht überein.';end if;
    outcome:=public.result_sync_sent_invitation(invitation,draft.updated_by);
   exception when others then outcome:=jsonb_build_object('status','error','message',sqlerrm);
   end;
  else outcome:=jsonb_build_object('status','disabled');
  end if;
  update public.calendar_club_reminders set result_sync_outcome=outcome where id=new.id;
 end if;
 return new;
end $$;
create or replace function public.create_t15_result_event(p_invitation jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid;src text:=trim(coalesce(p_invitation->>'sourceUrl',p_invitation->>'link',''));
begin
 if auth.uid() is null or not public.has_calendar_admin_access(auth.uid()) then raise exception 'Keine Berechtigung zur Turnieranlage.';end if;
 if src='' then raise exception 'Der zugehörige Termin fehlt.';end if;
 perform pg_advisory_xact_lock(hashtextextended(src,0));
 select id into eid from public.result_events where source_url=src;
 if found then if not public.result_can_access(eid) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;return eid;end if;
 return public.result_create_internal(p_invitation,auth.uid());
end $$;
commit;
