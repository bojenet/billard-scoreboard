begin;
create function public.update_result_from_invitation(p_id uuid,p_invitation jsonb,p_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;next_snapshot jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf Turnierdaten aktualisieren.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Der Turnierstand wurde inzwischen geändert. Bitte den Einladungsentwurf erneut öffnen.';end if;
 if e.status<>'open' or e.results<>'{}'::jsonb or exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %') then
  raise exception 'Turnierdaten können nur vor der ersten Ergebniserfassung aktualisiert werden.';
 end if;
 if coalesce(p_invitation->>'sourceUrl',p_invitation->>'link','') is distinct from e.source_url then raise exception 'Der zugehörige Termin darf nicht geändert werden.';end if;
 next_snapshot:=public.result_validate_snapshot(p_invitation);
 update public.result_events set snapshot=next_snapshot,title=coalesce(nullif(p_invitation->>'title',''),e.title),event_date=coalesce(p_invitation->>'date',p_invitation->>'eventDate',e.event_date),group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),'Turnierdaten aus Einladungsentwurf aktualisiert',jsonb_build_object('snapshot',e.snapshot,'version',e.version),jsonb_build_object('snapshot',next_snapshot,'version',e.version+1));
 return e.version+1;
end $$;
revoke all on function public.update_result_from_invitation(uuid,jsonb,integer) from public,anon;
grant execute on function public.update_result_from_invitation(uuid,jsonb,integer) to authenticated;
commit;
