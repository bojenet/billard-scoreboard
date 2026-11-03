begin;
alter table public.tournament_operation_tables add column warmup_until timestamptz;
create or replace function public.tournament_start_warmup(p_table text, p_event uuid, p_key text, p_running boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin(auth.uid()) then raise exception 'Kein Zugriff auf den Tischbetrieb.';end if;
 perform pg_advisory_xact_lock(823104);
 update public.tournament_operation_tables
 set completion=null, warmup_until=case when p_running then now() + interval '5 minutes' else null end
 where id=p_table and event_id=p_event and assignment->>'key'=p_key and not paused
   and (completion is null or completion->>'event_id'<>p_event::text
        or now() >= (completion->>'ended_at')::timestamptz + interval '1 minute');
 if not found then raise exception 'Die Einspielzeit kann noch nicht gestartet werden.';end if;
end $$;
revoke all on function public.tournament_start_warmup(text,uuid,text,boolean) from public,anon;
grant execute on function public.tournament_start_warmup(text,uuid,text,boolean) to authenticated;
commit;
