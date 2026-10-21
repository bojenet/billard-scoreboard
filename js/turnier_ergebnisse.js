(() => {
    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const params = new URLSearchParams(location.search);
    const eventId = params.get('turnier');
    let event = null, view = 'A', selected = 'A1', dirty = false, busy = false, pendingReload = null, reloadVersion = null;
    const player = seed => event?.snapshot.participants.find(p => p.seed === Number(seed));
    const name = seed => player(seed)?.name || 'Paarung noch offen';
    const mode = () => ResultModes.get(event.snapshot.selectedModeCode);
    const roundRobin = () => mode().kind === 'roundRobin';
    const groups = () => roundRobin() ? ['A'] : ['A','B'];
    const gd = (points, innings) => (innings ? Math.trunc(points / innings * 1000) / 1000 : 0).toFixed(3).replace('.', ',');
    function notice(text = '', error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
    async function rpc(fn, args) { const { data, error } = await supabaseClient.rpc(fn, args); if (error) throw error; return data; }
    function failure(error, target = 'message') {
        const text = error?.message || String(error);
        const message = text.includes('VERSION_CONFLICT') ? 'Jemand anderes hat zwischenzeitlich gespeichert. Bitte neu laden; deine Eingabe wurde nicht überschrieben.' : text;
        $(target).textContent = message; $(target).classList.add('error');
    }
    function canLeave() { return !dirty || window.confirm('Die aktuelle Eingabe wurde noch nicht gespeichert. Eingabe verwerfen?'); }
    async function load() {
        const next = await rpc('get_t15_result_event', { p_id: eventId });
        event = next; dirty = false; render();
        if (view === 'history') await history();
    }
    function render() {
        $('eventTitle').textContent = event.title;
        $('eventMeta').textContent = [event.event_date, event.snapshot.locationName, event.snapshot.discipline, `${event.snapshot.selectedModeCode} · ${event.snapshot.participants.length} Spieler`, `Ziel ${event.snapshot.playingTargetPoints} / ${event.snapshot.playingTargetInnings} Aufnahmen`].filter(Boolean).join(' · ');
        $('accessTab').hidden = !event.can_manage;
        $('reloadClubCloudBtn').hidden = !event.can_reload;
        if (!event.can_reload) { pendingReload=null; $('clubCloudPreview').hidden=true; }
        $('completeBtn').hidden = !event.can_manage || !!event.archived_ranking;
        $('completeBtn').textContent = event.status === 'completed' ? 'Für Korrektur wieder öffnen' : 'Turnier abschließen';
        if(roundRobin() && ['B','final'].includes(view))view='A';
        document.querySelector('[data-view="A"]').textContent=roundRobin() ? 'Partien' : 'Gruppe A';
        document.querySelector('[data-view="B"]').hidden=roundRobin();
        document.querySelector('[data-view="final"]').hidden=roundRobin();
        $('progress').max=event.schedule.length;
        $('progress').value = Object.keys(event.results).length;
        $('progressLabel').textContent = `${Object.keys(event.results).length} von ${event.schedule.length} Partien erfasst`;
        document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === view));
        $('entryView').hidden = !['A', 'B', 'final'].includes(view);
        $('standingsView').hidden = view !== 'standings'; $('accessView').hidden = view !== 'access'; $('historyView').hidden = view !== 'history';
        if (['A','B','final'].includes(view)) renderMatches();
        if (view === 'standings') renderStandings();
        if (view === 'access') renderMembers();
    }
    function renderMatches() {
        const games = event.schedule.filter(m => m.stage === view);
        if (!games.some(m => m.key === selected)) selected = games[0]?.key;
        $('matchListHeading').textContent = view === 'final' ? 'Platzierung & Finale' : roundRobin() ? 'Jeder gegen jeden' : `Gruppe ${view}`;
        $('matchList').innerHTML = games.map(m => {
            const r = event.results[m.key];
            const winner = !r ? 0 : m.stage === 'final' && r.winner ? Number(r.winner) : r.score1 > r.score2 ? 1 : r.score2 > r.score1 ? 2 : 0;
            const rows = [1,2].map(side => {
                const won = winner === side;
                const points = !r ? '—' : winner ? (won ? 2 : 0) : 1;
                return `<span class="match-player${won ? ' winner' : ''}"><span class="match-player-name">${won ? `<strong>${esc(name(m[`seed${side}`]))}</strong>` : esc(name(m[`seed${side}`]))}${won ? '<span class="result-sr-only"> · Sieger</span>' : ''}</span><span class="match-number" aria-label="Partiepunkte">${points}</span><span class="match-number" aria-label="Bälle">${r?.[`score${side}`] ?? '—'}</span><span class="match-number" aria-label="Aufnahmen">${r?.[`innings${side}`] ?? '—'}</span><span class="match-number" aria-label="GD">${r ? gd(r[`score${side}`], r[`innings${side}`]) : '—'}</span><span class="match-number" aria-label="Höchstserie">${r?.[`high${side}`] ?? '—'}</span></span>`;
            }).join('');
            return `<button class="match" type="button" data-key="${m.key}" aria-pressed="${selected === m.key}"><span class="match-meta"><span>${esc(m.label)}</span><span class="${r ? 'saved' : ''}">${r ? 'Erfasst' : m.ready ? 'Offen' : 'Paarung offen'}</span></span><span class="match-player-head" aria-hidden="true"><span>Spieler</span><abbr title="Partiepunkte">PP</abbr><span>Bälle</span><abbr title="Aufnahmen">Aufn.</abbr><abbr title="Generaldurchschnitt">GD</abbr><abbr title="Höchstserie">HS</abbr></span>${rows}</button>`;
        }).join('');
        $('matchList').querySelectorAll('[data-key]').forEach(b => b.onclick = () => { if (busy || !canLeave()) return; dirty = false; selected = b.dataset.key; renderMatches(); if (matchMedia('(max-width:760px)').matches) $('entryPanel').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
        renderEntry();
    }
    function renderEntry() {
        const match = event.schedule.find(m => m.key === selected), result = event.results[selected];
        $('entryTitle').textContent = result ? 'Ergebnis bearbeiten' : 'Ergebnis erfassen'; $('entryMeta').textContent = match.label;
        $('resultForm').hidden = !match.ready; $('notReady').hidden = match.ready;
        $('notReady').textContent = selected === 'F' || selected === 'P3' ? 'Zuerst beide Halbfinalspiele erfassen.' : 'Zuerst alle Gruppenpartien erfassen. Bei identischen Partiepunkten, GD und HS bleiben die betroffenen Plätze geteilt.';
        $('entryMessage').textContent = ''; $('entryMessage').className = '';
        if (!match.ready) return;
        $('playerInputs').innerHTML = [1,2].map(side => {
            const p = player(match[`seed${side}`]);
            return `<div class="player-input"><div class="player-name">${esc(p.name)}</div><div class="fields">${[['score','Bälle',0,event.snapshot.playingTargetPoints],['innings','Aufnahmen',1,event.snapshot.playingTargetInnings],['high','HS',0,event.snapshot.playingTargetPoints]].map(([key,label,min,max]) => `<label for="${key}${side}">${label}<input id="${key}${side}" type="number" inputmode="numeric" min="${min}" max="${Number(max)}" step="1" required value="${result?.[key + side] ?? ''}" ${event.status === 'completed' ? 'disabled' : ''}></label>`).join('')}</div></div>`;
        }).join('');
        $('winnerSelect').innerHTML = '<option value="">Sieger nach Entscheid wählen</option>' + [1,2].map(side => `<option value="${side}">${esc(name(match[`seed${side}`]))}</option>`).join('');
        $('winnerSelect').value = result?.winner || '';
        $('winnerSelect').disabled = event.status === 'completed';
        $('saveBtn').disabled = event.status === 'completed';
        $('deleteBtn').hidden = !result || event.status === 'completed';
        updateWinnerSelection();
    }
    function updateWinnerSelection() {
        if ($('resultForm').hidden) return;
        const match = event.schedule.find(m => m.key === selected);
        const tie = $('score1').value !== '' && $('score2').value !== '' && Number($('score1').value) === Number($('score2').value);
        $('winnerField').hidden = match.stage !== 'final' || !tie;
        $('winnerSelect').required = !$('winnerField').hidden;
    }
    async function saveResult(result, reset = false) {
        return rpc('save_t15_result', { p_id: eventId, p_key: selected, p_result: result, p_version: event.version, p_reset_dependents: reset });
    }
    async function withDependencyConfirmation(fn) {
        try { return await fn(false); } catch (error) {
            if (!error.message?.includes('DEPENDENTS_EXIST')) throw error;
            if (!window.confirm('Diese Änderung betrifft bereits erfasste Folgepartien. Deren Ergebnisse werden gelöscht; sie bleiben im Änderungsverlauf erhalten. Fortfahren?')) return false;
            return fn(true);
        }
    }
    async function submitResult(result) {
        if (busy) return;
        busy = true; $('saveBtn').disabled = true; $('deleteBtn').disabled = true;
        $('resultForm').querySelectorAll('input,select').forEach(input => input.disabled = true);
        try {
            const saved = await withDependencyConfirmation(reset => saveResult(result, reset));
            if (saved === false) return;
            await load(); $('entryMessage').textContent = result ? 'Ergebnis gespeichert.' : 'Ergebnis gelöscht.';
        } catch (error) { failure(error, 'entryMessage'); }
        finally { busy = false; $('saveBtn').disabled = event.status === 'completed'; $('deleteBtn').disabled = false; $('resultForm').querySelectorAll('input,select').forEach(input => input.disabled = event.status === 'completed'); }
    }
    function statsTable(rows) {
        return `<div class="table-wrap"><table class="standings-table"><colgroup><col class="col-rank"><col class="col-player"><col class="col-played"><col class="col-points"><col class="col-balls"><col class="col-innings"><col class="col-gd"><col class="col-high"></colgroup><thead><tr><th>Pl.</th><th>Spieler</th><th class="number">Sp.</th><th class="number">PP</th><th class="number">Bälle</th><th class="number">Aufn.</th><th class="number">GD</th><th class="number">HS</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.rank}${r.tied ? '*' : ''}</td><td>${esc(name(r.seed))}</td><td class="number">${r.played}</td><td class="number">${r.points}</td><td class="number">${r.balls}</td><td class="number">${r.innings}</td><td class="number">${gd(r.balls,r.innings)}</td><td class="number">${r.high}</td></tr>`).join('')}</tbody></table></div>`;
    }
    function groupRows(group) {
        const stats=event.standings[group];
        return stats.map(r=>({...r,tied:!event.archived_ranking && r.tied && r.played===stats.length-1}));
    }
    function renderStandings() {
        $('finalRoundPanel').hidden=roundRobin();
        $('finalStandingsHeading').textContent=roundRobin() ? 'Tabelle' : 'Endplatzierungen';
        if(roundRobin()) {
            $('groupStandings').innerHTML='';
            $('finalStandings').innerHTML=statsTable(groupRows('A'));
            return;
        }
        $('groupStandings').innerHTML=groups().map(group=>{
            const rows=groupRows(group);
            const fullTie=rows.some(r=>r.tied) && rows.every(r=>r.played===rows.length-1);
            return `<section class="panel"><div class="panel-heading"><h2>Gruppe ${group}</h2></div>${statsTable(rows)}${fullTie ? '<p class="form-content muted">* Partiepunkte, GD und HS sind identisch. Diese Spieler teilen sich den Platz; die Folgepaarungen stehen noch nicht eindeutig fest.</p>' : ''}</section>`;
        }).join('');
        const empty=()=>({points:0,balls:0,innings:0,high:0,played:0});
        const totals=new Map(event.snapshot.participants.map(p=>[p.seed,empty()]));
        const finalTotals=new Map(event.snapshot.participants.map(p=>[p.seed,empty()]));
        for(const match of event.schedule) {
            const r=event.results[match.key];if(!r || !match.ready)continue;
            for(const side of [1,2]) {
                const pp=match.stage==='final' ? (Number(r.winner)===side ? 2 : 0) : (r.score1===r.score2 ? 1 : ((r.score1>r.score2)===(side===1) ? 2 : 0));
                for(const map of (match.stage==='final' ? [totals,finalTotals] : [totals])) {
                    const t=map.get(match[`seed${side}`]);t.played++;t.points+=pp;t.balls+=r[`score${side}`];t.innings+=r[`innings${side}`];t.high=Math.max(t.high,r[`high${side}`]);
                }
            }
        }
        const ranks=[];
        for(const [key,first] of [['F',1],['P3',3],['P5',5],['P7',7]]) {
            const match=event.schedule.find(m=>m.key===key),r=event.results[key];
            if(r && match?.ready)ranks.push({rank:first,seed:match[`seed${r.winner}`]},{rank:first+1,seed:match[`seed${Number(r.winner)===1?2:1}`]});
        }
        if(event.snapshot.selectedModeCode==='T10' && event.schedule.find(m=>m.key==='HF1')?.ready) {
            ranks.push({rank:7,seed:event.standings.B[3].seed});
        }
        ranks.sort((a,b)=>a.rank-b.rank);
        const finalSeeds=new Set(event.schedule.filter(m=>m.stage==='final' && m.ready).flatMap(m=>[m.seed1,m.seed2]));
        const finalRows=[...finalSeeds].map(seed=>({seed,rank:ranks.find(r=>r.seed===seed)?.rank ?? '—',...finalTotals.get(seed)}))
            .sort((a,b)=>(typeof a.rank==='number' ? a.rank : 99)-(typeof b.rank==='number' ? b.rank : 99) || a.seed-b.seed);
        $('finalRoundStandings').innerHTML=finalRows.length ? statsTable(finalRows) : '<p class="form-content">Die Endrunde steht nach Abschluss der Gruppenspiele fest.</p>';
        $('finalStandings').innerHTML=ranks.length ? statsTable(ranks.map(r=>({...r,...totals.get(r.seed)}))) : '<p class="form-content">Die Endplatzierungen stehen nach den jeweiligen Final- und Platzierungsspielen fest.</p>';
    }
    function renderMembers() {
        $('membersList').innerHTML = event.members.length ? event.members.map(m=>`<div class="member-row"><span>${esc(m.email)}</span><button type="button" data-revoke="${esc(m.user_id)}">Zugang entziehen</button></div>`).join('') : '<p class="muted">Noch keine weiteren Personen zugeordnet.</p>';
        $('membersList').querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{
            if(!confirm('Diesen Turnierzugang entziehen?'))return;b.disabled=true;
            try{await rpc('revoke_t15_access',{p_id:eventId,p_user:b.dataset.revoke});await load();}catch(error){failure(error,'accessMessage');b.disabled=false;}
        });
    }
    async function history() {
        const {data,error}=await supabaseClient.from('result_event_history').select('id,action,created_at,before_state,after_state').eq('event_id',eventId).order('created_at',{ascending:false}).limit(100);
        if(error)throw error;
        $('historyList').innerHTML=(data||[]).map(h=>`<div class="history-row"><strong>${esc(h.action)}</strong> · ${new Date(h.created_at).toLocaleString('de-DE')}<details><summary>Gespeicherte Änderung ansehen</summary><pre>${esc(JSON.stringify({vorher:h.before_state,nachher:h.after_state},null,2))}</pre></details></div>`).join('')||'<p>Noch keine Ergebnisse geändert.</p>';
    }
    async function init() {
        const user = await requireAuth(); if (!user) return;
        const resultContext=await getResultEntryContext();
        const restricted=resultContext.result_only || resultContext.can_manage!==true;
        document.querySelectorAll('[data-full-navigation]').forEach(link=>link.hidden=restricted);
        $('resultListHelp').hidden=restricted;
        $('resultListDescription').hidden=restricted;
        if(restricted){$('resultsBrand').textContent='Turnierergebnisse';$('resultListTitle').textContent='Meine Turniere';document.title='Meine Turniere · Billard Studio';}
        if (params.get('zugang') === '1') $('passwordSection').hidden = false;
        if (!eventId) {
            $('listView').hidden=false;
            let events;
            if(restricted)events=resultContext.events;
            else {
                const {data,error}=await supabaseClient.from('result_events').select('id,title,event_date,status,updated_at,snapshot').order('updated_at',{ascending:false});
                if(error)throw error;
                events=(data||[]).map(e=>({...e,mode:e.snapshot.selectedModeCode,location:e.snapshot.locationName}));
            }
            $('eventList').innerHTML=events.map(e=>`<a class="event-link" href="turnier_ergebnisse.html?turnier=${encodeURIComponent(e.id)}"><strong>${esc(e.title)}</strong><span>${esc(e.event_date)} · ${esc(e.mode)}${e.location ? ` · ${esc(e.location)}` : ''} · ${e.status==='completed'?'Abgeschlossen':'Erfassung offen'}</span></a>`).join('')||'<p>Für dein Konto ist noch kein Turnier freigegeben.</p>';
            return;
        }
        await load(); $('eventView').hidden=false;
        document.querySelectorAll('[data-view]').forEach(b=>b.onclick=async()=>{
            if(busy||!canLeave())return;dirty=false;view=b.dataset.view;render();if(view==='history'){try{await history();}catch(error){failure(error);}}
        });
        $('resultForm').oninput=()=>{dirty=true;updateWinnerSelection();};
        $('resultForm').onsubmit=e=>{e.preventDefault();const result={};for(const side of [1,2])for(const field of ['score','innings','high'])result[field+side]=Number($(field+side).value);if(!$('winnerField').hidden)result.winner=Number($('winnerSelect').value);submitResult(result);};
        $('deleteBtn').onclick=()=>{if(confirm('Dieses Ergebnis löschen?'))submitResult(null);};
        $('reloadClubCloudBtn').onclick=async()=>{
            if(busy || !event.can_reload || !canLeave())return;
            busy=true;$('reloadClubCloudBtn').disabled=true;
            try{
                pendingReload=null;$('clubCloudPreview').hidden=true;
                const saved=await rpc('get_t15_result_event',{p_id:eventId});
                if(!saved.can_reload)throw new Error('Turnierdaten können nur vor der ersten Ergebniserfassung neu geladen werden.');
                notice('Aktuelle ClubCloud-Daten werden geladen …');
                const {data,error}=await supabaseClient.functions.invoke('get-nbv-tournament-invitation',{body:{sourceUrl:saved.source_url,disciplineId:saved.snapshot.disciplineId || '',disciplineLabel:saved.snapshot.discipline || '',rankingSeason:saved.snapshot.rankingSeason || ''}});
                if(error)throw error;
                if(data?.error)throw new Error(data.error);
                const response=await fetch('data/player-pass-numbers.json',{cache:'no-cache'});
                if(!response.ok)throw new Error('Die Passnummernliste konnte nicht geladen werden. Bitte erneut versuchen.');
                pendingReload=T15ClubCloudReload.prepare(saved,data?.invitation,await response.json());reloadVersion=saved.version;
                $('clubCloudMeta').textContent=[pendingReload.title,pendingReload.date,pendingReload.startTime,pendingReload.locationName,pendingReload.discipline].filter(Boolean).join(' · ');
                $('clubCloudParticipants').innerHTML='<table><thead><tr><th>Setzplatz</th><th>Spieler</th><th>Verein</th><th>Pass-Nr.</th></tr></thead><tbody>'+pendingReload.participants.map(p=>`<tr><td>${p.seed}</td><td>${esc(p.name)}</td><td>${esc(p.club)}</td><td>${esc(p.passNo || 'Fehlt – CSV-Export erst mit Passnummer möglich')}</td></tr>`).join('')+'</tbody></table>';
                $('reloadTarget').value=pendingReload.playingTargetPoints;$('reloadInnings').value=pendingReload.playingTargetInnings;
                $('clubCloudPreview').hidden=false;notice('ClubCloud-Daten geladen. Bitte Setzliste und Spielziel prüfen und übernehmen.');
            }catch(error){failure(error);}finally{busy=false;$('reloadClubCloudBtn').disabled=false;}
        };
        $('cancelClubCloudBtn').onclick=()=>{pendingReload=null;$('clubCloudPreview').hidden=true;notice();};
        $('clubCloudForm').onsubmit=async e=>{
            e.preventDefault();if(busy || !pendingReload)return;
            if(!canLeave())return;
            busy=true;$('applyClubCloudBtn').disabled=true;
            try{
                const invitation={...pendingReload,playingTargetPoints:$('reloadTarget').value,playingTargetInnings:$('reloadInnings').value};
                await rpc('refresh_t15_event_data',{p_id:eventId,p_invitation:invitation,p_version:reloadVersion});
                pendingReload=null;$('clubCloudPreview').hidden=true;
                await load();notice('Aktuelle ClubCloud-Daten übernommen. Die versendete Einladung bleibt unverändert.');
            }catch(error){failure(error);}finally{busy=false;$('applyClubCloudBtn').disabled=false;}
        };
        $('exportCsvBtn').onclick=async()=>{
            if(busy)return;
            busy=true;$('exportCsvBtn').disabled=true;
            try{
                const saved=await rpc('get_t15_result_event',{p_id:eventId});
                const csv=T15CsvExport.build(saved);
                const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
                const link=document.createElement('a');
                link.href=url;
                link.download=`${(saved.title || 'Turnier').replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g,'_')}_Ergebnisse.csv`;
                document.body.appendChild(link);link.click();link.remove();
                setTimeout(()=>URL.revokeObjectURL(url),1000);
                notice(`CSV mit ${Object.keys(saved.results).length} gespeicherten Partien exportiert.${dirty ? ' Deine ungespeicherte Eingabe ist nicht enthalten.' : ''}`);
            }catch(error){failure(error);}finally{busy=false;$('exportCsvBtn').disabled=false;}
        };
        $('completeBtn').onclick=async()=>{
            if(busy||!canLeave()||!confirm(event.status==='open'?'Turnier mit allen Ergebnissen abschließen?':'Turnier für Korrekturen wieder öffnen?'))return;busy=true;
            try{await rpc('set_t15_status',{p_id:eventId,p_status:event.status==='open'?'completed':'open',p_version:event.version});await load();notice('Turnierstatus gespeichert.');}catch(error){failure(error);}finally{busy=false;}
        };
        $('accessForm').onsubmit=async e=>{
            e.preventDefault();if(busy)return;busy=true;$('grantBtn').disabled=true;
            try{
                const email=$('accessEmail').value.trim();
                const existing=await rpc('grant_t15_access',{p_id:eventId,p_email:email});
                if(!existing){
                    if(!$('inviteNewUser').checked)throw new Error('Für diese E-Mail ist noch kein Konto vorhanden. Zum Anlegen und Versenden einer Zugangseinladung bitte die Option aktivieren.');
                    const {data,error}=await supabaseClient.functions.invoke('tournament-result-access',{body:{eventId,email}});
                    if(error||!data?.ok)throw new Error(data?.error||error?.message||'Zugangseinladung fehlgeschlagen.');
                    $('accessMessage').textContent='Persönliche Zugangseinladung versendet.';
                }else $('accessMessage').textContent='Zugang erteilt. Die Person kann ihren bestehenden Login verwenden.';
                $('accessMessage').classList.remove('error');$('accessEmail').value='';await load();
            }catch(error){failure(error,'accessMessage');}finally{busy=false;$('grantBtn').disabled=false;}
        };
        $('copyLinkBtn').onclick=async()=>{try{await navigator.clipboard.writeText(`${location.origin}${location.pathname}?turnier=${encodeURIComponent(eventId)}`);$('accessMessage').textContent='Link kopiert.';}catch(error){failure(new Error('Link konnte nicht kopiert werden. Bitte die Adresse aus dem Browser kopieren.'),'accessMessage');}};
        window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
    }
    $('passwordForm').onsubmit=async e=>{
        e.preventDefault();const password=$('newPassword').value;
        if(password!==$('confirmPassword').value){notice('Die beiden Passwörter stimmen nicht überein.',true);return;}
        try{const {error}=await supabaseClient.auth.updateUser({password});if(error)throw error;$('passwordSection').hidden=true;params.delete('zugang');window.history.replaceState(null,'',`${location.pathname}?${params}`);notice('Persönliches Passwort gespeichert.');}catch(error){failure(error);}
    };
    $('logoutBtn').onclick = async () => { if (!busy && canLeave()) await signOutAndRedirect(); };
    init().catch(error=>{failure(error);$('eventView').hidden=true;});
})();
