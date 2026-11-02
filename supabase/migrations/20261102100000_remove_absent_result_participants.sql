begin;
-- Invited tournament editors may adjust attendance, just as they may change modes.
create function public.remove_result_participants(p_id uuid,p_seeds integer[],p_mode text,p_version integer,p_reset boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;s jsonb;roster jsonb;before_state jsonb;remaining integer;removed integer;
begin
 perform pg_advisory_xact_lock(823104);
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Turnier wurde geändert. Bitte neu laden.';end if;
 if e.status<>'open' or e.archived_ranking is not null then raise exception 'Turnier zuerst für Korrekturen öffnen.';end if;
 if exists(select 1 from public.tournament_operation_tables where event_id=p_id) then raise exception 'Vor dem Entfernen von Spielern den Displaybetrieb beenden.';end if;
 if coalesce(cardinality(p_seeds),0)=0 or array_position(p_seeds,null) is not null then raise exception 'Bitte mindestens einen vorhandenen Spieler auswählen.';end if;
 select count(*) into removed from jsonb_array_elements(e.snapshot->'participants') p where (p->>'seed')::integer=any(p_seeds);
 if removed<>(select count(distinct seed) from unnest(p_seeds) seed) then raise exception 'Ein ausgewählter Spieler ist nicht mehr im Turnier.';end if;
 select coalesce(jsonb_agg(p||jsonb_build_object('number',n::text,'seed',n) order by n),'[]'::jsonb) into roster
 from (select p,row_number() over(order by (p->>'seed')::integer) n from jsonb_array_elements(e.snapshot->'participants') p where not((p->>'seed')::integer=any(p_seeds))) kept;
 remaining:=jsonb_array_length(roster);
 if public.result_mode(p_mode) is null then raise exception 'Dieser Modus wird nicht unterstützt.';end if;
 if (public.result_mode(p_mode)->>'count')::integer<>remaining then raise exception 'Der Modus passt nicht zur verbleibenden Teilnehmerzahl (% Spieler).',remaining;end if;
 if not coalesce(p_reset,false) and (e.results<>'{}'::jsonb or exists(select 1 from public.tournament_live_games where event_id=p_id and version>0)) then
  raise exception 'RESET_REQUIRED: Bei geänderter Teilnehmerliste müssen Ergebnisse und Live-Spielstände zurückgesetzt werden.';
 end if;
 before_state:=jsonb_build_object('snapshot',e.snapshot,'results',e.results,'group_order',e.group_order,'version',e.version,
  'live_games',(select coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) from public.tournament_live_games g where event_id=p_id));
 s:=public.result_validate_snapshot(e.snapshot||jsonb_build_object('participants',roster,'selectedModeCode',p_mode,'modeOverride',true,'rosterOverride',true));
 delete from public.tournament_live_games where event_id=p_id;
 update public.result_events set snapshot=s,results='{}',group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),'Nicht erschienene Spieler entfernt und Turniermodus angepasst',before_state,
  jsonb_build_object('snapshot',s,'results','{}'::jsonb,'removed_seeds',to_jsonb(p_seeds),'version',e.version+1));
 return e.version+1;
end $$;
revoke all on function public.remove_result_participants(uuid,integer[],text,integer,boolean) from public,anon;
grant execute on function public.remove_result_participants(uuid,integer[],text,integer,boolean) to authenticated;
commit;
