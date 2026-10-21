-- Private, invitation-bound tournament results. No scoreboard/matches changes.
alter table public.calendar_invitation_drafts add column if not exists updated_by uuid references auth.users(id) on delete set null;
create function public.result_stamp_invitation_editor() returns trigger language plpgsql set search_path='' as $$
begin
 if auth.uid() is not null then new.updated_by:=auth.uid(); end if;
 return new;
end $$;
create trigger result_invitation_editor before insert or update on public.calendar_invitation_drafts for each row execute function public.result_stamp_invitation_editor();
create table public.result_events (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references auth.users(id),
 source_url text not null unique,
 source_event_id text not null default '',
 title text not null,
 event_date text not null default '',
 snapshot jsonb not null,
 results jsonb not null default '{}',
 group_order jsonb not null default '{}',
 status text not null default 'open' check(status in ('open','completed')),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.result_event_members (
 event_id uuid not null references public.result_events(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 granted_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 primary key(event_id,user_id)
);
create table public.result_event_history (
 id bigint generated always as identity primary key,
 event_id uuid not null references public.result_events(id) on delete cascade,
 actor_id uuid references auth.users(id),
 action text not null,
 before_state jsonb,
 after_state jsonb not null,
 created_at timestamptz not null default now()
);
create index on public.result_event_members(user_id);
create index on public.result_event_history(event_id,created_at desc);

create function public.result_can_manage(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.result_events where id=p_id and (owner_user_id=auth.uid() or public.is_admin(auth.uid())));
$$;
create function public.result_can_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.result_can_manage(p_id) or exists(select 1 from public.result_event_members where event_id=p_id and user_id=auth.uid());
$$;
alter table public.result_events enable row level security;
alter table public.result_event_members enable row level security;
alter table public.result_event_history enable row level security;
revoke all on public.result_events,public.result_event_members,public.result_event_history from anon,authenticated;
grant select on public.result_events,public.result_event_members,public.result_event_history to authenticated;
grant all on public.result_events,public.result_event_members,public.result_event_history to service_role;
grant usage,select on sequence public.result_event_history_id_seq to service_role;
create policy result_events_private_read on public.result_events for select to authenticated using(public.result_can_access(id));
create policy result_members_manager_read on public.result_event_members for select to authenticated using(public.result_can_manage(event_id));
create policy result_history_private_read on public.result_event_history for select to authenticated using(public.result_can_access(event_id));

create function public.t15_group_pairs(p_group text) returns jsonb language plpgsql immutable set search_path='' as $$
declare seeds integer[]; pairs integer[][] := array[[1,4],[2,3],[1,3],[4,2],[1,2],[3,4]]; output jsonb:='[]'; i integer;
begin
 seeds:=case p_group when 'A' then array[1,4,5,8] when 'B' then array[2,3,6,7] end;
 if seeds is null then raise exception 'Unbekannte Gruppe'; end if;
 for i in 1..6 loop
  output:=output||jsonb_build_array(jsonb_build_object('key',p_group||i,'stage',p_group,'label','Partie '||i,'seed1',seeds[pairs[i][1]],'seed2',seeds[pairs[i][2]],'ready',true));
 end loop;
 return output;
end $$;

create function public.t15_group_stats(p_results jsonb,p_group text,p_order jsonb default '[]') returns jsonb language plpgsql immutable set search_path='' as $$
declare seed integer; seeds integer[]; g jsonb; r jsonb; side integer; points integer; balls integer; innings integer; high integer; played integer; output jsonb:='[]'; ordered jsonb;
begin
 seeds:=case p_group when 'A' then array[1,4,5,8] when 'B' then array[2,3,6,7] end;
 foreach seed in array seeds loop
  points:=0;balls:=0;innings:=0;high:=0;played:=0;
  for g in select value from jsonb_array_elements(public.t15_group_pairs(p_group)) loop
   r:=p_results->(g->>'key'); if r is null then continue; end if;
   side:=case when (g->>'seed1')::integer=seed then 1 when (g->>'seed2')::integer=seed then 2 else 0 end;
   if side=0 then continue; end if;
   played:=played+1;
   balls:=balls+(r->>('score'||side))::integer;
   innings:=innings+(r->>('innings'||side))::integer;
   high:=greatest(high,(r->>('high'||side))::integer);
   points:=points+case when (r->>'score1')::integer=(r->>'score2')::integer then 1 when ((r->>'score1')::integer>(r->>'score2')::integer)=(side=1) then 2 else 0 end;
  end loop;
  output:=output||jsonb_build_array(jsonb_build_object('seed',seed,'points',points,'balls',balls,'innings',innings,'high',high,'played',played,'gd',case when innings>0 then trunc(balls::numeric/innings,3) else 0 end));
 end loop;
 select jsonb_agg(v||jsonb_build_object('rank',rank,'tied',tie_count>1) order by rank) into ordered from (
  select value v,count(*) over(partition by value->>'points',value->>'gd',value->>'balls') tie_count,
   row_number() over(order by (value->>'points')::integer desc,(value->>'gd')::numeric desc,(value->>'balls')::integer desc,
    coalesce((select ord from jsonb_array_elements_text(p_order) with ordinality o(s,ord) where o.s=value->>'seed'),99), (value->>'seed')::integer) rank
  from jsonb_array_elements(output)
 ) q;
 return ordered;
end $$;

create function public.t15_schedule(p_results jsonb,p_order jsonb default '{}') returns jsonb language plpgsql immutable set search_path='' as $$
declare a jsonb; b jsonb; g jsonb; output jsonb; complete boolean:=true; a1 integer; a2 integer; a3 integer; a4 integer; b1 integer; b2 integer; b3 integer; b4 integer; w1 integer; w2 integer; l1 integer; l2 integer; r jsonb;
begin
 output:=public.t15_group_pairs('A')||public.t15_group_pairs('B');
 for g in select value from jsonb_array_elements(output) loop if not (p_results ? (g->>'key')) then complete:=false; end if; end loop;
 a:=public.t15_group_stats(p_results,'A',coalesce(p_order->'A','[]')); b:=public.t15_group_stats(p_results,'B',coalesce(p_order->'B','[]'));
 if (not (p_order ? 'A') and exists(select 1 from jsonb_array_elements(a) where (value->>'tied')::boolean)) or
    (not (p_order ? 'B') and exists(select 1 from jsonb_array_elements(b) where (value->>'tied')::boolean)) then complete:=false; end if;
 if complete then
  a1:=(a->0->>'seed')::integer;a2:=(a->1->>'seed')::integer;a3:=(a->2->>'seed')::integer;a4:=(a->3->>'seed')::integer;
  b1:=(b->0->>'seed')::integer;b2:=(b->1->>'seed')::integer;b3:=(b->2->>'seed')::integer;b4:=(b->3->>'seed')::integer;
  r:=p_results->'HF1';if r is not null then w1:=case when (r->>'winner')::integer=1 then a1 else b2 end;l1:=case when (r->>'winner')::integer=1 then b2 else a1 end;end if;
  r:=p_results->'HF2';if r is not null then w2:=case when (r->>'winner')::integer=1 then b1 else a2 end;l2:=case when (r->>'winner')::integer=1 then a2 else b1 end;end if;
 end if;
 output:=output||jsonb_build_array(
  jsonb_build_object('key','HF1','stage','final','label','Halbfinale 1','seed1',a1,'seed2',b2,'ready',complete),
  jsonb_build_object('key','HF2','stage','final','label','Halbfinale 2','seed1',b1,'seed2',a2,'ready',complete),
  jsonb_build_object('key','P7','stage','final','label','Spiel um Platz 7','seed1',a4,'seed2',b4,'ready',complete),
  jsonb_build_object('key','P5','stage','final','label','Spiel um Platz 5','seed1',a3,'seed2',b3,'ready',complete),
  jsonb_build_object('key','P3','stage','final','label','Spiel um Platz 3','seed1',l1,'seed2',l2,'ready',w1 is not null and w2 is not null),
  jsonb_build_object('key','F','stage','final','label','Finale','seed1',w1,'seed2',w2,'ready',w1 is not null and w2 is not null));
 return output;
end $$;

create function public.result_create_internal(p_invitation jsonb,p_owner uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid; src text:=trim(coalesce(p_invitation->>'sourceUrl',p_invitation->>'link','')); participant jsonb; normalized jsonb:='[]'; i integer:=0; seeds integer[]:='{}'; s integer; target integer; maxinn integer;
begin
 if p_invitation->>'selectedModeCode' is distinct from 'T15' then raise exception 'Zunächst wird nur Modus T15 unterstützt.'; end if;
 if p_owner is null or src='' then raise exception 'Termin und verantwortliche Person fehlen.';end if;
 select id into eid from public.result_events where source_url=src; if found then return eid;end if;
 if jsonb_typeof(p_invitation->'participants') is distinct from 'array' or jsonb_array_length(p_invitation->'participants')<>8 then raise exception 'T15 benötigt genau acht Teilnehmer.';end if;
 target:=(p_invitation->>'playingTargetPoints')::integer;maxinn:=(p_invitation->>'playingTargetInnings')::integer;
 if target is null or target<1 or maxinn is null or maxinn<1 then raise exception 'Punkte und Aufnahmenbegrenzung müssen positive ganze Zahlen sein.';end if;
 for participant in select value from jsonb_array_elements(p_invitation->'participants') loop
  i:=i+1;s:=coalesce(nullif(participant->>'number','')::integer,i);
  if s<1 or s>8 or s=any(seeds) or trim(coalesce(participant->>'name',''))='' then raise exception 'Setzliste unvollständig oder doppelte Setzplätze.';end if;
  seeds:=array_append(seeds,s);normalized:=normalized||jsonb_build_array(participant||jsonb_build_object('seed',s));
 end loop;
 insert into public.result_events(owner_user_id,source_url,source_event_id,title,event_date,snapshot)
 values(p_owner,src,coalesce(p_invitation->>'eventId',''),coalesce(nullif(p_invitation->>'title',''),'T15-Turnier'),coalesce(p_invitation->>'date',p_invitation->>'eventDate',''),p_invitation||jsonb_build_object('participants',normalized))
 on conflict(source_url) do nothing returning id into eid;
 if eid is null then select id into eid from public.result_events where source_url=src;end if;
 return eid;
end $$;

create function public.create_t15_result_event(p_invitation jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid; src text:=coalesce(p_invitation->>'sourceUrl',p_invitation->>'link','');
begin
 if auth.uid() is null or not public.has_calendar_admin_access(auth.uid()) then raise exception 'Keine Berechtigung zur Turnieranlage.';end if;
 select id into eid from public.result_events where source_url=src;
 if found then if not public.result_can_access(eid) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;return eid;end if;
 if not exists(select 1 from public.calendar_club_reminders where link=src and status='sent') then raise exception 'Bitte zuerst die Einladung für diesen Termin versenden.';end if;
 return public.result_create_internal(p_invitation,auth.uid());
end $$;

create function public.result_after_invitation_sent() returns trigger language plpgsql security definer set search_path='' as $$
declare draft public.calendar_invitation_drafts%rowtype;
begin
 if new.status='sent' and (tg_op='INSERT' or old.status is distinct from 'sent') then
  select * into draft from public.calendar_invitation_drafts where source_url=new.link;
  if found and draft.updated_by is not null and draft.invitation->>'selectedModeCode'='T15' then
   begin perform public.result_create_internal(draft.invitation,draft.updated_by);
   exception when others then raise warning 'T15-Erfassung nicht angelegt: %',sqlerrm;end;
  end if;
 end if;
 return new;
end $$;
create trigger result_invitation_sent after insert or update of status on public.calendar_club_reminders for each row execute function public.result_after_invitation_sent();

create function public.get_t15_result_event(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; members jsonb:='[]';
begin
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 select * into strict e from public.result_events where id=p_id;
 if public.result_can_manage(p_id) then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email) order by u.email),'[]') into members from public.result_event_members m join auth.users u on u.id=m.user_id where m.event_id=p_id;
 end if;
 return to_jsonb(e)||jsonb_build_object('can_manage',public.result_can_manage(p_id),'members',members,'schedule',public.t15_schedule(e.results,e.group_order),'standings',jsonb_build_object('A',public.t15_group_stats(e.results,'A',coalesce(e.group_order->'A','[]')),'B',public.t15_group_stats(e.results,'B',coalesce(e.group_order->'B','[]'))));
end $$;

create function public.save_t15_result(p_id uuid,p_key text,p_result jsonb,p_version integer,p_reset_dependents boolean default false) returns integer language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; old_state jsonb; g jsonb; v integer; f text; side integer; winner integer; remove_keys text[]:='{}'; k text; next_results jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 if e.status<>'open' then raise exception 'Turnier ist abgeschlossen. Die Turnierleitung muss es wieder öffnen.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Ein anderer Benutzer hat gespeichert. Bitte neu laden.';end if;
 select value into g from jsonb_array_elements(public.t15_schedule(e.results,e.group_order)) where value->>'key'=p_key;
 if g is null or not (g->>'ready')::boolean then raise exception 'Paarung steht noch nicht fest. Zuerst Gruppen und Gleichstände klären.';end if;
 old_state:=jsonb_build_object('results',e.results,'group_order',e.group_order,'version',e.version);
 if p_result is not null and p_result<>'null'::jsonb then
  for side in 1..2 loop
   foreach f in array array['score','innings','high'] loop
    if jsonb_typeof(p_result->(f||side)) is distinct from 'number' or (p_result->>(f||side)) !~ '^[0-9]+$' then raise exception 'Bitte vollständige ganzzahlige Ergebnisse eingeben.';end if;
    v:=(p_result->>(f||side))::integer;
    if v>1000000 then raise exception 'Eingabe ist zu groß.';end if;
   end loop;
   if (p_result->>('innings'||side))::integer<1 or (p_result->>('high'||side))::integer>(p_result->>('score'||side))::integer then raise exception 'Aufnahmen müssen positiv sein; HS darf die Punkte nicht überschreiten.';end if;
   if (p_result->>('score'||side))::integer>(e.snapshot->>'playingTargetPoints')::integer or (p_result->>('innings'||side))::integer>(e.snapshot->>'playingTargetInnings')::integer then raise exception 'Punkte oder Aufnahmen überschreiten das Spielziel der Einladung.';end if;
  end loop;
  p_result:=jsonb_build_object('score1',p_result->'score1','score2',p_result->'score2','innings1',p_result->'innings1','innings2',p_result->'innings2','high1',p_result->'high1','high2',p_result->'high2','winner',p_result->'winner');
  if g->>'stage'='final' then
   if (p_result->>'score1')::integer=(p_result->>'score2')::integer then
    winner:=(p_result->>'winner')::integer;if winner is null or winner not in(1,2) then raise exception 'Bei Gleichstand den Sieger nach Entscheid auswählen.';end if;
   else winner:=case when (p_result->>'score1')::integer>(p_result->>'score2')::integer then 1 else 2 end;end if;
   p_result:=p_result||jsonb_build_object('winner',winner);
  else p_result:=p_result-'winner';end if;
 end if;
 if (e.results->p_key) is not distinct from nullif(p_result,'null'::jsonb) then return e.version;end if;
 if g->>'stage' in ('A','B') then remove_keys:=array['HF1','HF2','P7','P5','P3','F'];
 elsif p_key in('HF1','HF2') then remove_keys:=array['P3','F'];end if;
 foreach k in array remove_keys loop
  if e.results ? k and not p_reset_dependents then raise exception 'DEPENDENTS_EXIST: Bereits erfasste Folgepartien müssen zurückgesetzt werden. Bitte bestätigen.';end if;
 end loop;
 next_results:=e.results-remove_keys;
 if p_result is null or p_result='null'::jsonb then next_results:=next_results-p_key;else next_results:=jsonb_set(next_results,array[p_key],p_result);end if;
 update public.result_events set results=next_results,group_order=case when g->>'stage' in('A','B') then group_order-(g->>'stage') else group_order end,version=version+1,updated_at=now() where id=p_id returning * into e;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state) values(p_id,auth.uid(),'Ergebnis '||p_key,old_state,jsonb_build_object('results',e.results,'group_order',e.group_order,'version',e.version));
 return e.version;
end $$;

create function public.set_t15_group_order(p_id uuid,p_group text,p_seeds jsonb,p_version integer,p_reset_dependents boolean default false) returns integer language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; stats jsonb; row jsonb; lastrow jsonb; s text; seen text[]:='{}'; k text; old_state jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_access(p_id) or e.status<>'open' then raise exception 'Keine Bearbeitungsberechtigung.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Bitte neu laden.';end if;
 if p_group not in('A','B') or jsonb_typeof(p_seeds) is distinct from 'array' or jsonb_array_length(p_seeds)<>4 then raise exception 'Vier Gruppenplätze erforderlich.';end if;
 stats:=public.t15_group_stats(e.results,p_group);
 if exists(select 1 from jsonb_array_elements(stats) where (value->>'played')::integer<>3) then raise exception 'Zuerst alle Gruppenpartien erfassen.';end if;
 for s in select value from jsonb_array_elements_text(p_seeds) loop
  select value into row from jsonb_array_elements(stats) where value->>'seed'=s;
  if row is null or s=any(seen) then raise exception 'Ungültige Gruppenplatzierung.';end if;
  if lastrow is not null and ((row->>'points')::integer,(row->>'gd')::numeric,(row->>'balls')::integer)>((lastrow->>'points')::integer,(lastrow->>'gd')::numeric,(lastrow->>'balls')::integer) then raise exception 'Nur vollständig gleichplatzierte Spieler dürfen umgeordnet werden.';end if;
  seen:=array_append(seen,s);lastrow:=row;
 end loop;
 foreach k in array array['HF1','HF2','P7','P5','P3','F'] loop if e.results ? k and not p_reset_dependents then raise exception 'DEPENDENTS_EXIST: Folgepartien zurücksetzen?';end if;end loop;
 old_state:=jsonb_build_object('results',e.results,'group_order',e.group_order);
 update public.result_events set group_order=jsonb_set(group_order,array[p_group],p_seeds),results=results-array['HF1','HF2','P7','P5','P3','F'],version=version+1,updated_at=now() where id=p_id returning * into e;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state) values(p_id,auth.uid(),'Gruppenentscheid '||p_group,old_state,jsonb_build_object('results',e.results,'group_order',e.group_order));return e.version;
end $$;

create function public.set_t15_status(p_id uuid,p_status text,p_version integer) returns integer language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; g jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf abschließen oder wieder öffnen.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Bitte neu laden.';end if;
 if p_status not in('open','completed') then raise exception 'Ungültiger Status.';end if;
 if p_status='completed' then
  for g in select value from jsonb_array_elements(public.t15_schedule(e.results,e.group_order)) loop if not (g->>'ready')::boolean or not e.results ? (g->>'key') then raise exception 'Es fehlen vollständige Ergebnisse oder Gruppenentscheide.';end if;end loop;
 end if;
 update public.result_events set status=p_status,version=version+1,updated_at=now() where id=p_id returning version into p_version;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state) values(p_id,auth.uid(),'Status geändert',jsonb_build_object('status',e.status),jsonb_build_object('status',p_status));return p_version;
end $$;

create function public.grant_t15_access(p_id uuid,p_email text) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf Zugänge vergeben.';end if;
 select id into uid from auth.users where lower(email)=lower(trim(p_email));
 if uid is null then return null;end if;
 insert into public.result_event_members(event_id,user_id,granted_by) values(p_id,uid,auth.uid()) on conflict do nothing;
 return uid;
end $$;
create function public.revoke_t15_access(p_id uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.result_can_manage(p_id) then raise exception 'Nur die Turnierleitung darf Zugänge entziehen.';end if;
 delete from public.result_event_members where event_id=p_id and user_id=p_user;
end $$;
-- No anonymous execution, even for pure helpers. Internal creation is not callable by clients.
revoke all on function public.result_create_internal(jsonb,uuid), public.result_after_invitation_sent(),public.result_stamp_invitation_editor() from public,anon,authenticated;
revoke all on function public.result_can_manage(uuid),public.result_can_access(uuid),public.t15_group_pairs(text),public.t15_group_stats(jsonb,text,jsonb),public.t15_schedule(jsonb,jsonb),public.create_t15_result_event(jsonb),public.get_t15_result_event(uuid),public.save_t15_result(uuid,text,jsonb,integer,boolean),public.set_t15_group_order(uuid,text,jsonb,integer,boolean),public.set_t15_status(uuid,text,integer),public.grant_t15_access(uuid,text),public.revoke_t15_access(uuid,uuid) from public,anon;
grant execute on function public.result_can_manage(uuid),public.result_can_access(uuid),public.create_t15_result_event(jsonb),public.get_t15_result_event(uuid),public.save_t15_result(uuid,text,jsonb,integer,boolean),public.set_t15_group_order(uuid,text,jsonb,integer,boolean),public.set_t15_status(uuid,text,integer),public.grant_t15_access(uuid,text),public.revoke_t15_access(uuid,uuid) to authenticated;

create function public.result_scope_invited_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.raw_user_meta_data->>'result_only'='true' then
  update public.user_roles set role='member',match_access='hidden',training_access='hidden',position_library_access='hidden',tournament_access='hidden',calendar_access='hidden',club_mobile_access='hidden',admin_center_access=false,stream_overlay_access=false where user_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.result_scope_invited_account() from public,anon,authenticated;
create trigger zz_result_only_invited_account after insert on auth.users for each row execute function public.result_scope_invited_account();
