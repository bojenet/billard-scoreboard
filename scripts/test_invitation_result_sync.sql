begin;
insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) values
('f3150000-0000-4000-8000-000000000041','invitation-sync-owner@example.invalid','{}','{}',now(),now()),
('f3150000-0000-4000-8000-000000000042','invitation-sync-editor@example.invalid','{}','{}',now(),now());
select set_config('request.jwt.claim.sub','f3150000-0000-4000-8000-000000000041',true);
do $$declare inv jsonb;eid uuid;v integer;outcome jsonb;begin
 select jsonb_build_object('sourceUrl','https://example.invalid/invitation-sync','selectedModeCode','T3','title','Initial','date','2026-10-21','playingTargetPoints','100','playingTargetInnings','20','participants',jsonb_agg(jsonb_build_object('number',i,'name','Spieler '||i))) into inv from generate_series(1,4) i;
 insert into public.calendar_invitation_drafts(source_url,invitation,updated_by) values(inv->>'sourceUrl',inv,auth.uid());
 insert into public.calendar_club_reminders(id,event_id,event_date,reminder_date,days_before,title,link,status) values('inv-sync-off','inv-sync',current_date,current_date,0,'Initial',inv->>'sourceUrl','sent');
 if exists(select 1 from public.result_events where source_url=inv->>'sourceUrl') then raise exception 'Unchecked invitation created tournament';end if;
 inv:=inv||'{"enableResultEntry":true}';
 update public.calendar_invitation_drafts set invitation=inv where source_url=inv->>'sourceUrl';
 insert into public.calendar_club_reminders(id,event_id,event_date,reminder_date,days_before,title,link,status,result_invitation_snapshot) values('inv-sync-on','inv-sync',current_date,current_date,0,'Initial',inv->>'sourceUrl','open',inv);
 if exists(select 1 from public.result_events where source_url=inv->>'sourceUrl') then raise exception 'Draft or pending send created tournament';end if;
 update public.calendar_club_reminders set status='sent' where id='inv-sync-on';
 select id,version into eid,v from public.result_events where source_url=inv->>'sourceUrl';
 if eid is null then raise exception 'Checked sent invitation did not create tournament';end if;
 select result_sync_outcome into outcome from public.calendar_club_reminders where id='inv-sync-on';
 if outcome->>'status'<>'created' or outcome->>'event_id'<>eid::text then raise exception 'Missing creation outcome';end if;
 perform public.grant_t15_access(eid,'invitation-sync-editor@example.invalid');
 -- The exact sent payload wins over a draft that was edited in the meantime.
 update public.calendar_invitation_drafts set invitation=inv||'{"title":"New unsent draft"}' where source_url=inv->>'sourceUrl';
 inv:=inv||'{"title":"Sent update","playingTargetPoints":"120"}';
 insert into public.calendar_club_reminders(id,event_id,event_date,reminder_date,days_before,title,link,status,result_invitation_snapshot) values('inv-sync-update','inv-sync',current_date,current_date,0,'Update',inv->>'sourceUrl','sent',inv);
 if (select title from public.result_events where id=eid)<>'Sent update' or (select snapshot->>'playingTargetPoints' from public.result_events where id=eid)<>'120' then raise exception 'Sent update not applied correctly';end if;
 if not exists(select 1 from public.result_event_members where event_id=eid and user_id='f3150000-0000-4000-8000-000000000042') then raise exception 'Access lost during update';end if;
 -- Same status does not apply a second time.
 select version into v from public.result_events where id=eid;
 update public.calendar_club_reminders set status='sent' where id='inv-sync-update';
 if (select version from public.result_events where id=eid)<>v then raise exception 'Duplicate update';end if;
 -- Explicitly unchecked payload overrides a checked draft.
 insert into public.calendar_club_reminders(id,event_id,event_date,reminder_date,days_before,title,link,status,result_invitation_snapshot) values('inv-sync-disabled','inv-sync',current_date,current_date,0,'Disabled',inv->>'sourceUrl','sent',inv||'{"enableResultEntry":false,"title":"Do not apply"}');
 if (select title from public.result_events where id=eid)<>'Sent update' then raise exception 'Unchecked update applied';end if;
 v:=public.save_t15_result(eid,'R1','{"score1":100,"score2":50,"innings1":20,"innings2":20,"high1":20,"high2":10}',v);
 insert into public.calendar_club_reminders(id,event_id,event_date,reminder_date,days_before,title,link,status,result_invitation_snapshot) values('inv-sync-blocked','inv-sync',current_date,current_date,0,'Blocked',inv->>'sourceUrl','sent',inv||'{"title":"Blocked change"}');
 if (select title from public.result_events where id=eid)<>'Sent update' or (select result_sync_outcome->>'status' from public.calendar_club_reminders where id='inv-sync-blocked')<>'blocked' then raise exception 'Captured data changed or warning missing';end if;
 v:=public.save_t15_result(eid,'R1',null,v);
 insert into public.calendar_club_reminders(id,event_id,event_date,reminder_date,days_before,title,link,status,result_invitation_snapshot) values('inv-sync-after-delete','inv-sync',current_date,current_date,0,'Blocked',inv->>'sourceUrl','sent',inv||'{"title":"Still blocked"}');
 if (select result_sync_outcome->>'status' from public.calendar_club_reminders where id='inv-sync-after-delete')<>'blocked' then raise exception 'Deleting results bypassed first-entry gate';end if;
 -- An invalid opted-in invitation records a sync error without undoing successful email status.
 inv:=inv||'{"sourceUrl":"https://example.invalid/invitation-sync-invalid","participants":[]}';
 insert into public.calendar_invitation_drafts(source_url,invitation,updated_by) values(inv->>'sourceUrl',inv,auth.uid());
 insert into public.calendar_club_reminders(id,event_id,event_date,reminder_date,days_before,title,link,status,result_invitation_snapshot) values('inv-sync-invalid','inv-sync-invalid',current_date,current_date,0,'Invalid',inv->>'sourceUrl','sent',inv);
 if (select result_sync_outcome->>'status' from public.calendar_club_reminders where id='inv-sync-invalid')<>'error' then raise exception 'Missing sync error';end if;
end $$;
select 'PASS: explicit opt-in, no creation on draft/pending send, exact sent snapshot, automatic update, stable access, idempotent send status, unchecked update, first-entry/deleted-result lock, persisted sync warning/error' as result;
rollback;
