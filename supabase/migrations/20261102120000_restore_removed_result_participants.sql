begin;
-- Recover players removed by the previous release from its audit history.
do $$
declare e record;first_roster jsonb;p jsonb;active jsonb;pool jsonb;original_order integer;
begin
 perform pg_advisory_xact_lock(823104);
 for e in select r.* from public.result_events r where not(r.snapshot ? 'removedParticipants') and exists(select 1 from public.result_event_history h where h.event_id=r.id and h.action='Nicht erschienene Spieler entfernt und Turniermodus angepasst') loop
  select h.before_state->'snapshot'->'participants' into first_roster from public.result_event_history h where h.event_id=e.id and h.id>coalesce((select max(reset.id) from public.result_event_history reset where reset.event_id=e.id and reset.action='Turnierdaten neu aus ClubCloud geladen'),0) and h.action='Nicht erschienene Spieler entfernt und Turniermodus angepasst' order by h.id limit 1;
  active:='[]';pool:='[]';
  for p in select value from jsonb_array_elements(e.snapshot->'participants') loop
   select (x->>'seed')::integer into original_order from jsonb_array_elements(first_roster) x where x->>'name'=p->>'name' and coalesce(x->>'club','')=coalesce(p->>'club','') and coalesce(x->>'passNo','')=coalesce(p->>'passNo','') limit 1;
   active:=active||jsonb_build_array(p||jsonb_build_object('attendance_id',gen_random_uuid(),'attendance_order',coalesce(original_order,(p->>'seed')::integer)));
  end loop;
  for p in select distinct entry.value from public.result_event_history h cross join lateral jsonb_array_elements(h.before_state->'snapshot'->'participants') entry(value) where h.event_id=e.id and h.id>coalesce((select max(reset.id) from public.result_event_history reset where reset.event_id=e.id and reset.action='Turnierdaten neu aus ClubCloud geladen'),0) and h.action='Nicht erschienene Spieler entfernt und Turniermodus angepasst' and h.after_state->'removed_seeds' @> jsonb_build_array((entry.value->>'seed')::integer) loop
   if exists(select 1 from jsonb_array_elements(active||pool) x where x->>'name'=p->>'name' and coalesce(x->>'club','')=coalesce(p->>'club','') and coalesce(x->>'passNo','')=coalesce(p->>'passNo','')) then continue;end if;
   select (x->>'seed')::integer into original_order from jsonb_array_elements(first_roster) x where x->>'name'=p->>'name' and coalesce(x->>'club','')=coalesce(p->>'club','') and coalesce(x->>'passNo','')=coalesce(p->>'passNo','') limit 1;
   pool:=pool||jsonb_build_array(p||jsonb_build_object('attendance_id',gen_random_uuid(),'attendance_order',coalesce(original_order,(p->>'seed')::integer)));
  end loop;
  update public.result_events set snapshot=snapshot||jsonb_build_object('participants',active,'removedParticipants',pool),version=version+1,updated_at=now() where id=e.id;
 end loop;
end $$;
create function public.adjust_result_participants(p_id uuid,p_seeds integer[],p_restore_ids uuid[],p_mode text,p_version integer,p_reset boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;s jsonb;roster jsonb;before_state jsonb;remaining integer;removed integer;pool jsonb;active jsonb;baseline jsonb;restored integer;
begin
 perform pg_advisory_xact_lock(823104);
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Turnier wurde geändert. Bitte neu laden.';end if;
 if e.status<>'open' or e.archived_ranking is not null then raise exception 'Turnier zuerst für Korrekturen öffnen.';end if;
 if exists(select 1 from public.tournament_operation_tables where event_id=p_id) then raise exception 'Vor dem Entfernen von Spielern den Displaybetrieb beenden.';end if;
 if array_position(p_seeds,null) is not null or array_position(p_restore_ids,null) is not null or (coalesce(cardinality(p_seeds),0)=0 and coalesce(cardinality(p_restore_ids),0)=0) then raise exception 'Bitte mindestens einen vorhandenen oder entfernten Spieler auswählen.';end if;
 select count(*) into removed from jsonb_array_elements(e.snapshot->'participants') p where (p->>'seed')::integer=any(coalesce(p_seeds,'{}'));
 if removed<>(select count(distinct seed) from unnest(p_seeds) seed) then raise exception 'Ein ausgewählter Spieler ist nicht mehr im Turnier.';end if;
 pool:=coalesce(e.snapshot->'removedParticipants','[]'::jsonb);
 select count(*) into restored from jsonb_array_elements(pool) p where (p->>'attendance_id')::uuid=any(coalesce(p_restore_ids,'{}'));
 if restored<>(select count(distinct id) from unnest(p_restore_ids) id) then raise exception 'Nur zuvor entfernte Spieler dieses Turniers können wiederhergestellt werden.';end if;
 active:='[]'::jsonb;
 for s in select value from jsonb_array_elements(e.snapshot->'participants') loop
  active:=active||jsonb_build_array(s||jsonb_build_object('attendance_id',coalesce(s->>'attendance_id',gen_random_uuid()::text),'attendance_order',coalesce((s->>'attendance_order')::integer,(s->>'seed')::integer)));
 end loop;
 select coalesce(jsonb_agg(p),'[]'::jsonb) into baseline from jsonb_array_elements(pool) p where (p->>'attendance_id')::uuid=any(coalesce(p_restore_ids,'{}'));
 select coalesce(jsonb_agg(p||jsonb_build_object('number',n::text,'seed',n) order by n),'[]'::jsonb) into roster
 from (select p,row_number() over(order by (p->>'attendance_order')::integer,p->>'attendance_id') n from (
  select p from jsonb_array_elements(active) p where not((p->>'seed')::integer=any(coalesce(p_seeds,'{}')))
  union all select p from jsonb_array_elements(baseline) p
 ) kept) ranked;
 select coalesce(jsonb_agg(p),'[]'::jsonb) into pool from (
  select p from jsonb_array_elements(pool) p where not((p->>'attendance_id')::uuid=any(coalesce(p_restore_ids,'{}')))
  union all select p from jsonb_array_elements(active) p where (p->>'seed')::integer=any(coalesce(p_seeds,'{}'))
 ) absent;
 remaining:=jsonb_array_length(roster);
 if public.result_mode(p_mode) is null then raise exception 'Dieser Modus wird nicht unterstützt.';end if;
 if (public.result_mode(p_mode)->>'count')::integer<>remaining then raise exception 'Der Modus passt nicht zur verbleibenden Teilnehmerzahl (% Spieler).',remaining;end if;
 if not coalesce(p_reset,false) and (e.results<>'{}'::jsonb or exists(select 1 from public.tournament_live_games where event_id=p_id and version>0)) then
  raise exception 'RESET_REQUIRED: Bei geänderter Teilnehmerliste müssen Ergebnisse und Live-Spielstände zurückgesetzt werden.';
 end if;
 before_state:=jsonb_build_object('snapshot',e.snapshot,'results',e.results,'group_order',e.group_order,'version',e.version,
  'live_games',(select coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) from public.tournament_live_games g where event_id=p_id));
 s:=public.result_validate_snapshot(e.snapshot||jsonb_build_object('participants',roster,'selectedModeCode',p_mode,'modeOverride',true,'rosterOverride',true,'removedParticipants',pool));
 delete from public.tournament_live_games where event_id=p_id;
 update public.result_events set snapshot=s,results='{}',group_order='{}',archived_ranking=null,version=version+1,updated_at=now() where id=p_id;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state)
 values(p_id,auth.uid(),case when restored>0 then 'Entfernte Spieler wiederhergestellt und Teilnehmerliste angepasst' else 'Nicht erschienene Spieler entfernt und Turniermodus angepasst' end,before_state,
  jsonb_build_object('snapshot',s,'results','{}'::jsonb,'removed_seeds',to_jsonb(p_seeds),'restored_ids',to_jsonb(p_restore_ids),'version',e.version+1));
 return e.version+1;
end $$;
create or replace function public.remove_result_participants(p_id uuid,p_seeds integer[],p_mode text,p_version integer,p_reset boolean default false) returns integer
language sql security definer set search_path='' as $$
 select public.adjust_result_participants(p_id,p_seeds,'{}'::uuid[],p_mode,p_version,p_reset);
$$;
revoke all on function public.adjust_result_participants(uuid,integer[],uuid[],text,integer,boolean) from public,anon;
grant execute on function public.adjust_result_participants(uuid,integer[],uuid[],text,integer,boolean) to authenticated;
commit;
