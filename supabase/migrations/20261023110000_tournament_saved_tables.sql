begin;
-- Retain table assignments for tournaments already running before this update.
update public.result_events e set snapshot=jsonb_set(e.snapshot,'{tableIds}',x.ids)
from (select event_id,jsonb_agg(id order by id) ids from public.tournament_operation_tables where event_id is not null group by event_id) x
where e.id=x.event_id and not(e.snapshot ? 'tableIds');

update public.calendar_invitation_drafts d set invitation=jsonb_set(d.invitation,'{tableIds}',e.snapshot->'tableIds')
from public.result_events e where d.source_url=e.source_url and not(d.invitation ? 'tableIds') and jsonb_array_length(coalesce(e.snapshot->'tableIds','[]'))>0;

create function public.validate_result_table_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare ids jsonb:=coalesce(new.snapshot->'tableIds','[]');
begin
 -- Older callers without this field must not silently discard saved assignments.
 if tg_op='UPDATE' and not(new.snapshot ? 'tableIds') then ids:=coalesce(old.snapshot->'tableIds','[]');end if;
 if jsonb_typeof(ids)<>'array' then raise exception 'Tischzuordnung muss eine Liste sein.';end if;
 if exists(select 1 from jsonb_array_elements_text(ids) x where x not in ('tb01','tb02','tb03','tb04','mb01','mb02')) or (select count(*)<>count(distinct x) from jsonb_array_elements_text(ids) x) then raise exception 'Ungültige oder doppelte Tischzuordnung.';end if;
 new.snapshot:=jsonb_set(new.snapshot,'{tableIds}',ids);
 if tg_op='UPDATE' and new.snapshot is distinct from old.snapshot and exists(select 1 from public.tournament_operation_tables where event_id=new.id) then raise exception 'Turnierbetrieb läuft. Vor Änderungen den Betrieb beenden.';end if;
 new.snapshot:=jsonb_set(new.snapshot,'{tableIds}',ids);
 return new;
end $$;
revoke all on function public.validate_result_table_assignment() from public,anon,authenticated;
create trigger validate_result_table_assignment before insert or update of snapshot on public.result_events for each row execute function public.validate_result_table_assignment();
create or replace function public.tournament_operation(p_action text,p_table text default null,p_event uuid default null,p_tables text[] default null) returns jsonb
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
   select array_agg(value order by ord) into p_tables from jsonb_array_elements_text(coalesce(e.snapshot->'tableIds','[]')) with ordinality as x(value,ord);
   if coalesce(cardinality(p_tables),0)=0 or cardinality(p_tables)>6 then raise exception 'Keine Tische im Turnier gespeichert. Bitte in der Einladung festlegen und Turnierdaten aktualisieren.';end if;
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
 return jsonb_build_object('tables',(select jsonb_agg(to_jsonb(x) order by id) from public.tournament_operation_tables x),'events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'tableIds',coalesce(snapshot->'tableIds','[]')) order by event_date desc),'[]') from public.result_events));
end $$;

commit;
