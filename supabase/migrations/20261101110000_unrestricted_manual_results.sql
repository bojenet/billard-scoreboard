-- Manual results may exceed the configured playing goals.
create or replace function public.save_t15_result(p_id uuid,p_key text,p_result jsonb,p_version integer,p_reset_dependents boolean default false) returns integer language plpgsql security definer set search_path='' as $$
declare e public.result_events%rowtype; old_state jsonb; g jsonb; v integer; f text; side integer; winner integer; remove_keys text[]:='{}'; k text; next_results jsonb;
begin
 select * into strict e from public.result_events where id=p_id for update;
 if not public.result_can_access(p_id) then raise exception 'Kein Zugriff auf dieses Turnier.';end if;
 if e.status<>'open' then raise exception 'Turnier ist abgeschlossen. Die Turnierleitung muss es wieder öffnen.';end if;
 if e.version is distinct from p_version then raise exception 'VERSION_CONFLICT: Ein anderer Benutzer hat gespeichert. Bitte neu laden.';end if;
 select value into g from jsonb_array_elements(public.result_schedule(e.snapshot,e.results,e.group_order)) where value->>'key'=p_key;
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
 if g->>'stage' in ('A','B','C') then remove_keys:=array['HF1','HF2','P8','P9','P7','P5','P3','F'];
 elsif p_key in('HF1','HF2') then remove_keys:=array['P3','F'];elsif p_key='P8' then remove_keys:=array['P7'];end if;
 foreach k in array remove_keys loop
  if e.results ? k and not p_reset_dependents then raise exception 'DEPENDENTS_EXIST: Bereits erfasste Folgepartien müssen zurückgesetzt werden. Bitte bestätigen.';end if;
 end loop;
 next_results:=e.results-remove_keys;
 if p_result is null or p_result='null'::jsonb then next_results:=next_results-p_key;else next_results:=jsonb_set(next_results,array[p_key],p_result);end if;
 update public.result_events set results=next_results,group_order=case when g->>'stage' in('A','B','C') then group_order-(g->>'stage') else group_order end,version=version+1,updated_at=now() where id=p_id returning * into e;
 insert into public.result_event_history(event_id,actor_id,action,before_state,after_state) values(p_id,auth.uid(),'Ergebnis '||p_key,old_state,jsonb_build_object('results',e.results,'group_order',e.group_order,'version',e.version));
 return e.version;
end $$;
