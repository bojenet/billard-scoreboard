create or replace function public.select_result_event_tables(p_id uuid, p_tables text[], p_version integer)
returns void
language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Nur Administratoren dürfen Turniertische auswählen.'; end if;
 perform pg_advisory_xact_lock(823104);
 select * into strict e from public.result_events where id=p_id for update;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Bitte neu laden.'; end if;
 if e.status<>'open' or exists(select 1 from public.tournament_operation_tables where event_id=p_id) then
  raise exception 'Die Tischauswahl ist nur bei offenem Turnier und beendetem Tischbetrieb möglich.';
 end if;
 if coalesce(cardinality(p_tables),0)=0 or cardinality(p_tables)<>(select count(distinct t.id) from public.tournament_operation_tables t where t.id=any(p_tables)) then
  raise exception 'Bitte mindestens einen gültigen Tisch auswählen.';
 end if;
 update public.result_events
 set snapshot=jsonb_set(e.snapshot,'{tableIds}',to_jsonb(p_tables)),version=e.version+1,updated_at=now()
 where id=p_id;
end $$;

revoke all on function public.select_result_event_tables(uuid,text[],integer) from public, anon;
grant execute on function public.select_result_event_tables(uuid,text[],integer) to authenticated;
