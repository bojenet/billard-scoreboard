-- Execute after the warmup migration. Test changes are rolled back.
begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f5000000-0000-4000-8000-000000000001','warmup-controller@example.invalid','{}','{}',now(),now()),
('f5000000-0000-4000-8000-000000000002','warmup-outsider@example.invalid','{}','{}',now(),now());
update public.user_roles set club_mobile_access='edit' where user_id='f5000000-0000-4000-8000-000000000001';
update public.user_roles set club_mobile_access='hidden',role='member' where user_id='f5000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000001',true);
select set_config('test.warmup_table',coalesce((select t from (values('tisch1'),('tisch2')) tables(t) where not exists(select 1 from public.matches where display_table=t and status=1 and finished=false) order by t limit 1),''),true);
select set_config('test.warmup_other',case current_setting('test.warmup_table') when 'tisch1' then 'tisch2' else 'tisch1' end,true);
do $$
declare t public.table_warmup_timers%rowtype; stale integer; denied boolean; other_before jsonb;
begin
 if current_setting('test.warmup_table')='' then raise exception 'A free table is required for this rolled-back test';end if;
 select to_jsonb(other_clock) into other_before from public.table_warmup_timers other_clock where table_id=current_setting('test.warmup_other');
 update public.table_warmup_timers set active=false,running=false,remaining_seconds=300,duration_seconds=300,started_at=null where table_id=current_setting('test.warmup_table');
 select * into t from public.table_warmup_timers where table_id=current_setting('test.warmup_table');
 t:=public.control_table_warmup(current_setting('test.warmup_table'),'duration',t.revision,600);
 if t.duration_seconds<>600 or t.active then raise exception '10-minute selection failed';end if;
 stale:=t.revision;t:=public.control_table_warmup(current_setting('test.warmup_table'),'start',t.revision);
 if not t.running or not t.active or t.remaining_seconds<>600 then raise exception 'Start failed';end if;
 denied:=false;begin perform public.control_table_warmup(current_setting('test.warmup_table'),'reset',stale);exception when others then if position('VERSION_CONFLICT' in sqlerrm)>0 then denied:=true;else raise;end if;end;
 if not denied then raise exception 'Stale revision accepted';end if;
 update public.table_warmup_timers set started_at=clock_timestamp()-interval '12 seconds' where table_id=current_setting('test.warmup_table');
 t:=public.control_table_warmup(current_setting('test.warmup_table'),'pause',t.revision);
 if t.running or t.remaining_seconds not between 587 and 589 or not t.active then raise exception 'Pause failed: %',t;end if;
 t:=public.control_table_warmup(current_setting('test.warmup_table'),'start',t.revision);
 if t.remaining_seconds not between 587 and 589 or not t.running then raise exception 'Resume restarted full duration';end if;
 if (select to_jsonb(other_clock) from public.table_warmup_timers other_clock where table_id=current_setting('test.warmup_other'))<>other_before then raise exception 'Other table changed';end if;
 denied:=false;begin perform public.control_table_warmup(current_setting('test.warmup_table'),'duration',t.revision,120);exception when others then denied:=true;end;
 if not denied then raise exception 'Invalid duration accepted';end if;
 update public.table_warmup_timers set started_at=clock_timestamp()-interval '11 minutes' where table_id=current_setting('test.warmup_table');
 t:=public.control_table_warmup(current_setting('test.warmup_table'),'pause',t.revision);if t.remaining_seconds<>0 then raise exception 'Expired timer below/above zero';end if;
 t:=public.control_table_warmup(current_setting('test.warmup_table'),'start',t.revision);if t.remaining_seconds<>600 then raise exception 'Explicit restart failed';end if;
 insert into public.matches(id,player1,player2,display_table,status,finished) values(-202610215001,'Warmup Test A','Warmup Test B',current_setting('test.warmup_table'),1,false);
 select * into t from public.table_warmup_timers where table_id=current_setting('test.warmup_table');
 if t.running or t.active then raise exception 'Match start did not hide warmup';end if;
 denied:=false;begin perform public.control_table_warmup(current_setting('test.warmup_table'),'start',t.revision);exception when others then if position('läuft noch eine Partie' in sqlerrm)>0 then denied:=true;else raise;end if;end;
 if not denied then raise exception 'Warmup allowed during active match';end if;
 update public.matches set finished=true where id=-202610215001;
 t:=public.control_table_warmup(current_setting('test.warmup_table'),'duration',t.revision,300);t:=public.control_table_warmup(current_setting('test.warmup_table'),'start',t.revision);t:=public.control_table_warmup(current_setting('test.warmup_table'),'reset',t.revision);
 if t.active or t.running or t.remaining_seconds<>300 then raise exception 'Reset failed';end if;
end $$;
select set_config('request.jwt.claim.sub','f5000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$declare revision integer;denied boolean:=false;begin
 select t.revision into revision from public.table_warmup_timers t where table_id=current_setting('test.warmup_table');
 begin perform public.control_table_warmup(current_setting('test.warmup_table'),'start',revision);exception when others then denied:=true;end;
 if not denied then raise exception 'Unauthorized user can control warmup';end if;
end $$;
reset role;
set local role anon;
do $$declare n integer;denied boolean:=false;begin
 select count(*) into n from public.table_warmup_timers;if n<>2 then raise exception 'Pi cannot read clocks';end if;
 begin update public.table_warmup_timers set running=true;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Anonymous direct update allowed';end if;
 denied:=false;begin perform public.control_table_warmup(current_setting('test.warmup_table'),'start',1);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Anonymous RPC allowed';end if;
end $$;
reset role;
select 'PASS: 5/10 minutes, start/pause/resume/reset, expiration, table isolation, concurrency, match-start handover, app rights and anonymous read-only Pi' as result;
rollback;
