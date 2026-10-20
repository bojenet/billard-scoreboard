-- Each expiry consumes one timeout. The second expiry stops the clock.
-- Pi displays are anonymous readers. Permit only this checked clock transition,
-- never unrestricted writes to a displayed match.
create or replace function public.advance_expired_shot_clock(
  p_match_id bigint,
  p_started_at timestamptz,
  p_active_player bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches%rowtype;
  used integer;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then return jsonb_build_object('action', 'noop'); end if;
  if m.display_table not in ('tisch1', 'tisch2') or m.display_table is null
     or m.status is distinct from 1 or m.finished is not false
     or m.shot_clock_running is not true
     or m.shot_clock_started_at is null
     or date_trunc('milliseconds', m.shot_clock_started_at) is distinct from date_trunc('milliseconds', p_started_at)
     or m."activePlayer" is distinct from p_active_player
     or p_active_player not in (1, 2)
     or lower(trim(case when p_active_player = 1 then m.discipline1 else m.discipline2 end))
        is distinct from 'dreiband'
     or m.shot_clock_remaining_seconds is null
     or clock_timestamp() < m.shot_clock_started_at + make_interval(secs => m.shot_clock_remaining_seconds)
  then return jsonb_build_object('action', 'noop'); end if;

  used := coalesce(case when p_active_player = 1 then m.shot_clock_timeouts1 else m.shot_clock_timeouts2 end, 0);
  used := least(2, greatest(0, used) + 1);

  update public.matches
  set shot_clock_timeouts1 = case when p_active_player = 1 then used else shot_clock_timeouts1 end,
      shot_clock_timeouts2 = case when p_active_player = 2 then used else shot_clock_timeouts2 end,
      shot_clock_running = used < 2,
      shot_clock_started_at = case when used < 2 then date_trunc('milliseconds', clock_timestamp()) else null end,
      shot_clock_remaining_seconds = case when used < 2 then 40 else 0 end
  where id = p_match_id
  returning * into m;

  return jsonb_build_object('action', case when used < 2 then 'extended' else 'expired' end, 'clock', jsonb_build_object(
    'shot_clock_running', m.shot_clock_running,
    'shot_clock_started_at', m.shot_clock_started_at,
    'shot_clock_remaining_seconds', m.shot_clock_remaining_seconds,
    'shot_clock_timeouts1', m.shot_clock_timeouts1,
    'shot_clock_timeouts2', m.shot_clock_timeouts2
  ));
end;
$$;

revoke all on function public.advance_expired_shot_clock(bigint, timestamptz, bigint) from public;
grant execute on function public.advance_expired_shot_clock(bigint, timestamptz, bigint) to anon, authenticated;
