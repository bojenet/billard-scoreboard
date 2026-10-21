(() => {
    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const params = new URLSearchParams(location.search);
    const eventId = params.get('turnier');
    let event = null, view = 'A', selected = 'A1', dirty = false, busy = false;
    const player = seed => event?.snapshot.participants.find(p => p.seed === Number(seed));
    const name = seed => player(seed)?.name || 'Paarung noch offen';
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
        $('eventMeta').textContent = [event.event_date, event.snapshot.locationName, event.snapshot.discipline, 'T15 · 8 Spieler', `Ziel ${event.snapshot.playingTargetPoints} / ${event.snapshot.playingTargetInnings} Aufnahmen`].filter(Boolean).join(' · ');
        $('invitationNote').textContent = 'Teilnehmer und Spielziel stammen aus der versendeten Einladung. ' + (event.status === 'completed' ? 'Dieses Turnier ist abgeschlossen.' : 'Ergebnisse sind nur für die Turnierleitung und zugeordnete Personen sichtbar.');
        $('accessTab').hidden = !event.can_manage;
        $('completeBtn').hidden = !event.can_manage;
        $('completeBtn').textContent = event.status === 'completed' ? 'Für Korrektur wieder öffnen' : 'Turnier abschließen';
        $('progress').value = Object.keys(event.results).length;
        $('progressLabel').textContent = `${Object.keys(event.results).length} von 18 Partien erfasst`;
        document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === view));
        $('entryView').hidden = !['A', 'B', 'final'].includes(view);
        $('standingsView').hidden = view !== 'standings'; $('accessView').hidden = view !== 'access'; $('historyView').hidden = view !== 'history';
        if (['A','B','final'].includes(view)) renderMatches();
        if (view === 'standings') renderStandings();
        if (view === 'access') renderMembers();
    }
    function renderMatches() {
        const games = event.schedule.filter(m => m.stage === view);
        if (!games.some(m => m.key === selected)) selected = games[0].key;
        $('matchListHeading').textContent = view === 'final' ? 'Platzierung & Finale' : `Gruppe ${view}`;
        $('matchList').innerHTML = games.map(m => {
            const r = event.results[m.key];
            return `<button class="match" type="button" data-key="${m.key}" aria-pressed="${selected === m.key}"><span class="match-meta"><span>${esc(m.label)}</span><span class="${r ? 'saved' : ''}">${r ? 'Erfasst' : m.ready ? 'Offen' : 'Paarung offen'}</span></span><span class="match-pair"><span>${esc(name(m.seed1))}<br>${esc(name(m.seed2))}</span><span class="score">${r ? `${r.score1} : ${r.score2}` : '— : —'}</span></span></button>`;
        }).join('');
        $('matchList').querySelectorAll('[data-key]').forEach(b => b.onclick = () => { if (busy || !canLeave()) return; dirty = false; selected = b.dataset.key; renderMatches(); if (matchMedia('(max-width:760px)').matches) $('entryPanel').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
        renderEntry();
    }
    function renderEntry() {
        const match = event.schedule.find(m => m.key === selected), result = event.results[selected];
        $('entryTitle').textContent = result ? 'Ergebnis bearbeiten' : 'Ergebnis erfassen'; $('entryMeta').textContent = match.label;
        $('resultForm').hidden = !match.ready; $('notReady').hidden = match.ready;
        $('notReady').textContent = selected === 'F' || selected === 'P3' ? 'Zuerst beide Halbfinalspiele erfassen.' : 'Zuerst alle Gruppenpartien erfassen und gegebenenfalls vollständige Gleichstände unter „Tabellen“ auflösen.';
        $('entryMessage').textContent = ''; $('entryMessage').className = '';
        if (!match.ready) return;
        $('playerInputs').innerHTML = [1,2].map(side => {
            const p = player(match[`seed${side}`]);
            return `<div class="player-input"><div class="player-name">${esc(p.name)}</div><div class="player-club">${esc(p.club || '')}${p.passNo ? ` · Pass-Nr. ${esc(p.passNo)}` : ''}</div><div class="fields">${[['score','Punkte',0,event.snapshot.playingTargetPoints],['innings','Aufnahmen',1,event.snapshot.playingTargetInnings],['high','HS',0,event.snapshot.playingTargetPoints]].map(([key,label,min,max]) => `<label for="${key}${side}">${label}<input id="${key}${side}" type="number" inputmode="numeric" min="${min}" max="${Number(max)}" step="1" required value="${result?.[key + side] ?? ''}" ${event.status === 'completed' ? 'disabled' : ''}></label>`).join('')}</div></div>`;
        }).join('');
        $('winnerSelect').innerHTML = '<option value="">Sieger nach Entscheid wählen</option>' + [1,2].map(side => `<option value="${side}">${esc(name(match[`seed${side}`]))}</option>`).join('');
        $('winnerSelect').value = result?.winner || '';
        $('winnerSelect').disabled = event.status === 'completed';
        $('saveBtn').disabled = event.status === 'completed';
        $('deleteBtn').hidden = !result || event.status === 'completed';
        updateAverages();
    }
    function updateAverages() {
        if ($('resultForm').hidden) return;
        const values = [1,2].map(s => gd(Number($(`score${s}`).value), Number($(`innings${s}`).value)));
        $('averages').textContent = `GD: ${values[0]} / ${values[1]}`;
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
    function tableHTML(group) {
        return `<div class="table-wrap"><table><thead><tr><th>Pl.</th><th>Spieler</th><th>Sp.</th><th>PP</th><th>Bälle</th><th>Aufn.</th><th>GD</th><th>HS</th></tr></thead><tbody>${event.standings[group].map(r => `<tr><td>${r.rank}${r.tied && !event.group_order[group] ? '*' : ''}</td><td>${esc(name(r.seed))}</td><td class="number">${r.played}</td><td class="number">${r.points}</td><td class="number">${r.balls}</td><td class="number">${r.innings}</td><td class="number">${gd(r.balls,r.innings)}</td><td class="number">${r.high}</td></tr>`).join('')}</tbody></table></div>`;
    }
    function renderStandings() {
        $('groupStandings').innerHTML = ['A','B'].map(group => {
            const stats = event.standings[group], complete = stats.every(s => s.played === 3), tie = stats.some(s => s.tied);
            const order = complete && tie ? `<form data-order="${group}" class="form-content"><p>${event.group_order[group] ? 'Gruppenentscheid gespeichert.' : '* Vollständiger Gleichstand: Reihenfolge nach Entscheid festlegen.'}</p><div class="order-fields">${stats.map((row,i) => `<label>Platz ${i+1}<select name="rank${i}">${stats.map(s => `<option value="${s.seed}" ${s.seed === row.seed ? 'selected' : ''}>${esc(name(s.seed))}</option>`).join('')}</select></label>`).join('')}</div><button type="submit" ${event.status !== 'open' ? 'disabled' : ''}>Gruppenentscheid speichern</button></form>` : '';
            return `<section class="panel"><div class="panel-heading"><h2>Gruppe ${group}</h2><span class="muted">PP → GD (3 Stellen) → Bälle</span></div>${tableHTML(group)}${order}</section>`;
        }).join('');
        $('groupStandings').querySelectorAll('[data-order]').forEach(form => form.onsubmit = async e => {
            e.preventDefault(); if (busy) return; busy = true;
            try {
                const seeds = [...form.querySelectorAll('select')].map(s => Number(s.value));
                const saved = await withDependencyConfirmation(reset => rpc('set_t15_group_order', { p_id:eventId,p_group:form.dataset.order,p_seeds:seeds,p_version:event.version,p_reset_dependents:reset }));
                if (saved !== false) { await load(); notice('Gruppenentscheid gespeichert.'); }
            } catch(error) { failure(error); } finally { busy = false; }
        });
        const totals = new Map(event.snapshot.participants.map(p => [p.seed,{points:0,innings:0,high:0}]));
        for (const match of event.schedule) {
            const r=event.results[match.key]; if (!r || !match.ready) continue;
            for (const side of [1,2]) { const t=totals.get(match[`seed${side}`]); t.points+=r[`score${side}`];t.innings+=r[`innings${side}`];t.high=Math.max(t.high,r[`high${side}`]); }
        }
        const ranks = [];
        for (const [key,first] of [['F',1],['P3',3],['P5',5],['P7',7]]) {
            const match=event.schedule.find(m=>m.key===key),r=event.results[key];
            if(r && match.ready){ranks.push({rank:first,seed:match[`seed${r.winner}`]},{rank:first+1,seed:match[`seed${r.winner===1?2:1}`]});}
        }
        ranks.sort((a,b)=>a.rank-b.rank);
        $('finalStandings').innerHTML = ranks.length ? `<div class="table-wrap"><table><thead><tr><th>Platz</th><th>Spieler</th><th>Pass-Nr.</th><th>Bälle</th><th>Aufn.</th><th>GD</th><th>HS</th></tr></thead><tbody>${ranks.map(r=>{const t=totals.get(r.seed);return `<tr><td>${r.rank}</td><td>${esc(name(r.seed))}</td><td>${esc(player(r.seed).passNo || '')}</td><td class="number">${t.points}</td><td class="number">${t.innings}</td><td class="number">${gd(t.points,t.innings)}</td><td class="number">${t.high}</td></tr>`;}).join('')}</tbody></table></div>` : '<p>Die Endplatzierungen stehen nach den jeweiligen Final- und Platzierungsspielen fest.</p>';
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
        if (params.get('zugang') === '1') $('passwordSection').hidden = false;
        if (!eventId) {
            $('listView').hidden=false;
            const {data,error}=await supabaseClient.from('result_events').select('id,title,event_date,status,updated_at').order('updated_at',{ascending:false});
            if(error)throw error;
            $('eventList').innerHTML=(data||[]).map(e=>`<a class="event-link" href="turnier_ergebnisse.html?turnier=${encodeURIComponent(e.id)}"><strong>${esc(e.title)}</strong><span>${esc(e.event_date)} · T15 · ${e.status==='completed'?'Abgeschlossen':'Erfassung offen'}</span></a>`).join('')||'<p>Für dein Konto ist noch kein Turnier freigegeben.</p>';
            return;
        }
        await load(); $('eventView').hidden=false;
        document.querySelectorAll('[data-view]').forEach(b=>b.onclick=async()=>{
            if(busy||!canLeave())return;dirty=false;view=b.dataset.view;render();if(view==='history'){try{await history();}catch(error){failure(error);}}
        });
        $('resultForm').oninput=()=>{dirty=true;updateAverages();};
        $('resultForm').onsubmit=e=>{e.preventDefault();const result={};for(const side of [1,2])for(const field of ['score','innings','high'])result[field+side]=Number($(field+side).value);if(!$('winnerField').hidden)result.winner=Number($('winnerSelect').value);submitResult(result);};
        $('deleteBtn').onclick=()=>{if(confirm('Dieses Ergebnis löschen?'))submitResult(null);};
        $('reloadBtn').onclick=async()=>{if(busy||!canLeave())return;try{await load();notice();}catch(error){failure(error);}};
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
