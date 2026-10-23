begin;
create table public.tournament_operation_tables (
 id text primary key check(id in ('tb01','tb02','tb03','tb04','mb01','mb02')),
 last_seen timestamptz,
 event_id uuid references public.result_events(id) on delete set null,
 assignment jsonb,
 paused boolean not null default false
);
insert into public.tournament_operation_tables(id) values ('tb01'),('tb02'),('tb03'),('tb04'),('mb01'),('mb02');
alter table public.tournament_operation_tables enable row level security;
revoke all on public.tournament_operation_tables from anon,authenticated;
create function public.tournament_operation(p_action text,p_table text default null,p_event uuid default null,p_tables text[] default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; t text; g jsonb; used integer[]:='{}'; chosen jsonb:='[]'; v_assignment jsonb;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Nur Administratoren haben Zugriff auf den Tischbetrieb.';end if;
 if p_action='heartbeat' then
  update public.tournament_operation_tables set last_seen=now() where id=p_table;
  if not found then raise exception 'Unbekannter Tisch.';end if;
  return (select to_jsonb(x) from public.tournament_operation_tables x where id=p_table);
 end if;
 if p_action not in ('state','start','pause','resume','stop') then raise exception 'Unbekannte Aktion.';end if;
 if p_action<>'state' then
  perform pg_advisory_xact_lock(823104);
  if p_event is null then raise exception 'Bitte ein Turnier wählen.';end if;
  select * into strict e from public.result_events where id=p_event for update;
  if p_action='start' then
   if e.status<>'open' then raise exception 'Das Turnier ist abgeschlossen.';end if;
   if coalesce(cardinality(p_tables),0)=0 or cardinality(p_tables)>6 then raise exception 'Bitte Tische wählen.';end if;
   if (select count(distinct x) from unnest(p_tables) x)<>cardinality(p_tables) then raise exception 'Tisch mehrfach gewählt.';end if;
   if exists(select 1 from public.tournament_operation_tables where event_id=p_event) then raise exception 'Das Turnier ist bereits gestartet.';end if;
   foreach t in array p_tables loop
    if not exists(select 1 from public.tournament_operation_tables where id=t and last_seen>now()-interval '30 seconds' and event_id is null) then raise exception 'Tisch % ist offline oder belegt.',t;end if;
   end loop;
   foreach t in array p_tables loop
    v_assignment:=null;
    for g in select value from jsonb_array_elements(public.result_schedule(e.snapshot,e.results,e.group_order)) loop
     if (g->>'ready')::boolean and not(e.results ? (g->>'key')) and not ((g->>'seed1')::integer=any(used)) and not ((g->>'seed2')::integer=any(used)) then
      v_assignment:=g||jsonb_build_object('title',e.title,'snapshot',e.snapshot);
      used:=used||array[(g->>'seed1')::integer,(g->>'seed2')::integer];exit;
     end if;
    end loop;
    update public.tournament_operation_tables set event_id=p_event,assignment=v_assignment,paused=false where id=t;
    if v_assignment is not null then chosen:=chosen||jsonb_build_array(v_assignment);end if;
   end loop;
   if jsonb_array_length(chosen)=0 then raise exception 'Keine spielbereiten Partien vorhanden.';end if;
  elsif p_action='stop' then
   update public.tournament_operation_tables set event_id=null,assignment=null,paused=false where event_id=p_event;
  else
   update public.tournament_operation_tables set paused=(p_action='pause') where event_id=p_event;
  end if;
 end if;
 return jsonb_build_object('tables',(select jsonb_agg(to_jsonb(x) order by id) from public.tournament_operation_tables x),'events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status) order by event_date desc),'[]') from public.result_events));
end $$;
revoke all on function public.tournament_operation(text,text,uuid,text[]) from public,anon;
grant execute on function public.tournament_operation(text,text,uuid,text[]) to authenticated;
commit;
