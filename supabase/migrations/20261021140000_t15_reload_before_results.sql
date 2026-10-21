begin;
-- Reloading is permitted only before the first result entry, including deleted entries.
create function public.refresh_t15_event_data(p_id uuid,p_invitation jsonb,p_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; participant jsonb; normalized jsonb:='[]'; seeds integer[]:='{}'; i integer:=0; s integer;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf Turnierdaten neu laden.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Bitte neu laden.';end if;
 if e.status<>'open' or e.results<>'{}'::jsonb or exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %') then
  raise exception 'Turnierdaten können nur vor der ersten Ergebniserfassung neu geladen werden.';
 end if;
 if p_invitation->>'selectedModeCode' is distinct from 'T15' then raise exception 'Zunächst wird nur Modus T15 unterstützt.';end if;
 if p_invitation->>'sourceUrl' is distinct from e.source_url then raise exception 'Die ClubCloud-Quelle darf nicht geändert werden.';end if;
 if jsonb_typeof(p_invitation->'participants') is distinct from 'array' then raise exception 'T15 benötigt genau acht Teilnehmer.';end if;
 if jsonb_array_length(p_invitation->'participants')<>8 then raise exception 'T15 benötigt genau acht Teilnehmer.';end if;
 if coalesce(p_invitation->>'playingTargetPoints','') !~ '^[0-9]+$' or coalesce(p_invitation->>'playingTargetInnings','') !~ '^[0-9]+$' then raise exception 'Punkte und Aufnahmen müssen positive ganze Zahlen sein.';end if;
 if (p_invitation->>'playingTargetPoints')::integer not between 1 and 1000000 or (p_invitation->>'playingTargetInnings')::integer not between 1 and 1000000 then raise exception 'Punkte und Aufnahmen müssen zwischen 1 und 1000000 liegen.';end if;
 for participant in select value from jsonb_array_elements(p_invitation->'participants') loop
  i:=i+1;s:=coalesce(nullif(participant->>'number','')::integer,i);
  if s not between 1 and 8 or s=any(seeds) or trim(coalesce(participant->>'name',''))='' then raise exception 'Setzliste unvollständig oder doppelte Setzplätze.';end if;
  seeds:=array_append(seeds,s);normalized:=normalized||jsonb_build_array(participant||jsonb_build_object('seed',s));
 end loop;
 update public.result_events set snapshot=p_invitation||jsonb_build_object('participants',normalized),
 title=coalesce(nullif(trim(p_invitation->>'title'),''),e.title),event_date=coalesce(p_invitation->>'date',p_invitation->>'eventDate',e.event_date),
 group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),'Turnierdaten neu aus ClubCloud geladen',jsonb_build_object('snapshot',e.snapshot,'version',e.version),jsonb_build_object('snapshot',p_invitation||jsonb_build_object('participants',normalized),'version',e.version+1));
 return e.version+1;
end $$;
revoke all on function public.refresh_t15_event_data(uuid,jsonb,integer) from public,anon;
grant execute on function public.refresh_t15_event_data(uuid,jsonb,integer) to authenticated;

create or replace function public.get_t15_result_event(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; members jsonb:='[]';
begin
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 select * into strict e from public.result_events where id=p_id;
 if public.result_can_manage(p_id) then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email) order by u.email),'[]') into members from public.result_event_members m join auth.users u on u.id=m.user_id where m.event_id=p_id;
 end if;
 return to_jsonb(e)||jsonb_build_object('can_manage',public.result_can_manage(p_id),'can_reload',public.result_can_manage(p_id) and e.status='open' and e.results='{}'::jsonb and not exists(select 1 from public.result_event_history where event_id=p_id and action like 'Ergebnis %'),'members',members,'schedule',coalesce(e.archived_ranking->'schedule',public.t15_schedule(e.results,e.group_order)),'standings',coalesce(e.archived_ranking->'standings',jsonb_build_object('A',public.t15_group_stats(e.results,'A',coalesce(e.group_order->'A','[]')),'B',public.t15_group_stats(e.results,'B',coalesce(e.group_order->'B','[]')))));
end $$;


commit;
