create or replace function public.tournament_dispatch_event(p_event uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;t public.tournament_operation_tables%rowtype;g jsonb;plan jsonb;used integer[]:='{}';assigned text[]:='{}';next_game jsonb;
begin
 if p_event is null then return;end if;
 perform pg_advisory_xact_lock(823104);
 select * into e from public.result_events where id=p_event for update;
 if not found or not exists(select 1 from public.tournament_operation_tables where event_id=p_event) then return;end if;
 if e.status='completed' then
  update public.tournament_operation_tables set event_id=null,assignment=null,paused=false,completion=jsonb_build_object('event_id',e.id,'title',e.title,'ended_at',now(),'assignment',assignment) where event_id=e.id;
  return;
 end if;
 if exists(select 1 from public.tournament_operation_tables where event_id=p_event and paused) then return;end if;
 -- Recover already-finished games, including displays opened before this deployment.
 for t in select * from public.tournament_operation_tables where event_id=p_event order by id loop
  perform public.tournament_save_ready(t.id);
 end loop;
 select * into strict e from public.result_events where id=p_event;
 plan:=public.result_schedule(e.snapshot,e.results,e.group_order);
 if jsonb_array_length(plan)>0 and not exists(select 1 from jsonb_array_elements(plan) x where not coalesce((x->>'ready')::boolean,false) or not(e.results ? (x->>'key'))) then
  update public.result_events set status='completed',version=version+1,updated_at=now() where id=p_event;
  insert into public.result_event_history(event_id,actor_id,action,before_state,after_state) values(e.id,auth.uid(),'Turnier automatisch abgeschlossen',jsonb_build_object('status',e.status,'version',e.version),jsonb_build_object('status','completed','version',e.version+1));
  update public.tournament_operation_tables set event_id=null,assignment=null,paused=false,completion=jsonb_build_object('event_id',e.id,'title',e.title,'ended_at',now(),'assignment',assignment) where event_id=e.id;
  return;
 end if;
 -- Keep the whole batch on its tables until every assigned game has a result.
 if exists(
  select 1 from public.tournament_operation_tables
  where event_id=p_event and assignment is not null and not(e.results ? (assignment->>'key'))
 ) then return;end if;
 update public.tournament_operation_tables set assignment=null where event_id=p_event and assignment is not null;
 for t in select * from public.tournament_operation_tables where event_id=p_event and assignment is null and last_seen>now()-interval '30 seconds' order by id loop
  next_game:=null;
  for g in select value from jsonb_array_elements(plan) loop
   if coalesce((g->>'ready')::boolean,false) and not(e.results ? (g->>'key')) and not((g->>'key')=any(assigned)) and not((g->>'seed1')::integer=any(used)) and not((g->>'seed2')::integer=any(used)) then next_game:=g;exit;end if;
  end loop;
  if next_game is not null then
   update public.tournament_operation_tables set assignment=next_game||jsonb_build_object('title',e.title,'snapshot',e.snapshot),completion=null where id=t.id;
   assigned:=array_append(assigned,next_game->>'key');
   used:=used||array[(next_game->>'seed1')::integer,(next_game->>'seed2')::integer];
  end if;
 end loop;
end $$;
