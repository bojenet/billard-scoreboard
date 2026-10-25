begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values ('f3150000-0000-4000-8000-000000000091','table-score@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000091',true);
do $$declare inv jsonb;eid uuid;d jsonb;s jsonb;key text;v integer;begin
 begin perform public.tournament_table_input('tb01','00000000-0000-0000-0000-000000000000','R1',0,'points',1);raise exception 'Non-admin input allowed';exception when others then if position('freigeschaltete' in sqlerrm)=0 then raise;end if;end;
 update public.user_roles set role='admin' where user_id=auth.uid();
 select jsonb_build_object('sourceUrl','https://example.invalid/scoring-test','selectedModeCode','T3','tableIds',jsonb_build_array('tb01','tb02'),'title','Scoring test','playingTargetPoints','10','playingTargetInnings','2','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into inv from generate_series(1,4) i;
 eid:=public.create_t15_result_event(inv);
 update public.tournament_operation_tables set event_id=null,assignment=null,last_seen=now();
 perform public.tournament_operation('start',null,eid);
 d:=public.tournament_table_state('tb01');key:=d->'assignment'->>'key';

 d:=public.tournament_table_input('tb01',eid,key,0,'swap');
 if d->'live_state'->>'swapped'<>'true' or d->'live_state'->>'active'<>'1' or d->'live_state'->>'innings1'<>'0' then raise exception 'Swap must preserve first turn';end if;
 d:=public.tournament_table_input('tb01',eid,key,1,'swap');
 if d->'live_state'->>'swapped'<>'false' then raise exception 'Swap back failed';end if;
 d:=public.tournament_table_input('tb01',eid,key,2,'swap');
 d:=public.tournament_table_input('tb01',eid,key,3,'points',10);
 begin perform public.tournament_table_input('tb01',eid,key,4,'swap');raise exception 'Swap after scoring allowed';exception when others then if position('vor der ersten' in sqlerrm)=0 then raise;end if;end;
 d:=public.tournament_table_input('tb01',eid,key,4,'turn');
 if (d->'live_state'->>'done')::boolean then raise exception 'Nachstoss missing';end if;
 d:=public.tournament_table_input('tb01',eid,key,5,'points',7);
 d:=public.tournament_table_input('tb01',eid,key,6,'turn');
 select results->key into s from public.result_events where id=eid;
 if s->>'score1'<>'7' or s->>'score2'<>'10' or s->>'high1'<>'7' or s->>'high2'<>'10' then raise exception 'Results attributed to wrong player: %',s;end if;
 if public.tournament_ordered_result('{"winner":1,"score1":5,"score2":5,"innings1":2,"innings2":2,"high1":3,"high2":4}', '{"swapped":true}')->>'winner'<>'2' then raise exception 'KO winner mapping failed';end if;
end $$;
select 'PASS: repeated start-player swap, first turn preserved, swap blocked after scoring, Nachstoss preserved, saved scores and HS mapped to original pairing, KO winner mapping' result;
rollback;
