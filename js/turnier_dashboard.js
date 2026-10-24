/* Tournament overview only. Existing app matches and scoreboard controllers are untouched. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const tableIds = ['tb01', 'tb02', 'tb03', 'tb04', 'mb01', 'mb02'];
    let event, tables = [], connected = false, polling = false, acting = false, timer, overview = true, generation = 0;
    const name = seed => event.snapshot.participants.find(p => Number(p.seed) === Number(seed))?.name || 'Paarung noch offen';
    const rpc = async (fn, args) => {
        const { data, error } = await supabaseClient.rpc(fn, args);
        if (error) throw error;
        return data;
    };
    function openMatch(key) {
        window.location.href = `turnier_ergebnisse.html?turnier=${encodeURIComponent(event.id)}&partie=${encodeURIComponent(key)}`;
    }
    function savedTables() {
        return (event.snapshot.tableIds || []).filter(id => tableIds.includes(id));
    }
    const isOnline = table => table?.last_seen && Date.now() - Date.parse(table.last_seen) < 30000;
    const ownTables = () => tables.filter(t => t.event_id === event.id);
    const assignmentFor = key => ownTables().find(t => t.assignment?.key === key);
    function renderOperations() {
        const ids = savedTables();
        const active = ownTables();
        const paused = active.length > 0 && active.every(t => t.paused);
        const blocked = ids.filter(id => {
            const t = tables.find(t => t.id === id);
            return !isOnline(t) || (t.event_id && t.event_id !== event.id);
        });
        $('operationTables').textContent = ids.length ? 'Tische: ' + ids.map(id => id.toUpperCase()).join(', ') : 'Tische in der Einladung festlegen und Turnierdaten aktualisieren.';
        $('operationStatus').textContent = !connected ? 'Tischstatus nicht verfügbar' : active.length ? (paused ? 'Turnier pausiert' : 'Tischbetrieb gestartet') : event.status === 'completed' ? 'Turnier abgeschlossen' : ids.length && !blocked.length ? 'Bereit zum Start' : 'Start noch nicht möglich';
        $('operationStart').hidden = active.length > 0 || event.status === 'completed';
        $('operationStart').disabled = acting || !connected || !ids.length || blocked.length > 0;
        $('operationStart').title = blocked.length ? 'Nicht bereit: ' + blocked.map(id => id.toUpperCase()).join(', ') : '';
        $('operationPause').hidden = !active.length || paused;
        $('operationResume').hidden = !paused;
        $('operationStop').hidden = !active.length;
        for (const id of ['operationPause', 'operationResume', 'operationStop']) $(id).disabled = acting || !connected;
        $('dashboardTables').innerHTML = [...new Set([...ids, ...active.map(t => t.id)])].map(id => {
            const table = tables.find(t => t.id === id);
            const own = table?.event_id === event.id;
            const game = own ? table.assignment : null;
            const result = game ? event.results[game.key] : null;
            const online = connected && isOnline(table);
            const state = !connected ? 'Status unbekannt' : !online ? 'Offline' : table.event_id && !own ? 'Anderes Turnier' : own ? (table.paused ? 'Pausiert' : game ? (result ? 'Ergebnis gespeichert' : 'Partie zugewiesen') : 'Wartet auf nächste Partie') : 'Bereit';
            const snap = game?.snapshot || event.snapshot;
            const playerName = seed => snap.participants.find(p => Number(p.seed) === Number(seed))?.name || 'Paarung offen';
            return `<article class="dashboard-table"><div class="dashboard-table-head"><h3>${esc(id.toUpperCase())}</h3><span class="${online ? 'dashboard-online' : 'dashboard-offline'}">${esc(state)}</span></div>${game ? `<div class="dashboard-scoreboard">${[1,2].map(side => `<div class="dashboard-side side-${side}"><div class="dashboard-player">${esc(playerName(game['seed' + side]))}</div><strong class="dashboard-score">${result?.['score' + side] ?? 0}</strong><span class="dashboard-innings">Aufnahmen <b>${result?.['innings' + side] ?? 0}</b></span></div>`).join('')}</div><p class="dashboard-game-label">${esc(game.roundLabel)} · ${esc(game.label)}</p>` : `<p class="dashboard-table-wait">${own ? 'Wartet auf die nächste Paarung' : 'Wartet auf Turnierstart'}</p>`}<a href="turnier_tisch.html?tisch=${encodeURIComponent(id)}" target="_blank" rel="noopener">Tischdisplay öffnen ↗</a></article>`;
        }).join('') || '<p class="muted">Diesem Turnier sind noch keine Tische zugeordnet. <a href="calendar.html">Einladung bearbeiten</a></p>';
    }
    function renderOverview() {
        const next = event.schedule.filter(m => m.ready && !event.results[m.key] && !assignmentFor(m.key));
        $('dashboardNext').innerHTML = next.slice(0, 6).map(m => `<button class="dashboard-next" data-game="${esc(m.key)}" type="button"><span>${esc(m.roundLabel)} · ${esc(m.label)}</span><strong>${esc(name(m.seed1))} <span>–</span> ${esc(name(m.seed2))}</strong></button>`).join('') || '<p class="form-content muted">Keine weiteren spielbereiten Paarungen.</p>';
        const groups = ResultModes.get(event.snapshot.selectedModeCode).kind === 'roundRobin' ? ['A'] : ['A','B'];
        $('dashboardStandings').innerHTML = groups.map(group => `<div class="dashboard-ranking"><h3>${groups.length > 1 ? 'Gruppe ' + group : 'Jeder gegen jeden'}</h3><div class="table-wrap"><table><thead><tr><th>Pl.</th><th>Spieler</th><th class="number">PP</th><th class="number">GD</th><th class="number">HS</th></tr></thead><tbody>${(event.standings[group] || []).map(r => `<tr><td>${r.rank}${r.tied ? '*' : ''}</td><td>${esc(name(r.seed))}</td><td class="number">${r.points}</td><td class="number">${(r.innings ? Math.trunc(r.balls / r.innings * 1000) / 1000 : 0).toFixed(3).replace('.', ',')}</td><td class="number">${r.high}</td></tr>`).join('')}</tbody></table></div></div>`).join('');
        $('dashboardProgress').textContent = `${Object.keys(event.results).length} / ${event.schedule.length} Partien erfasst`;
        $('dashboardSchedule').innerHTML = event.schedule.map(m => {
            const t = assignmentFor(m.key), r = event.results[m.key];
            const state = r ? `${r.score1} : ${r.score2}` : t ? (t.paused ? 'Pausiert' : 'Zugewiesen') : m.ready ? 'Offen' : 'Paarung offen';
            return `<tr><td>${esc(m.roundLabel)}<br><small>${esc(m.label)}</small></td><td>${esc(name(m.seed1))}<br>${esc(name(m.seed2))}</td><td>${esc(t?.id.toUpperCase() || '—')}</td><td>${esc(state)}</td><td><button type="button" data-game="${esc(m.key)}">${r ? 'Manuell korrigieren' : 'Manuell erfassen'}</button></td></tr>`;
        }).join('');
        $('dashboardParticipants').innerHTML = event.snapshot.participants.map(p => `<span><b>${esc(p.seed)}.</b> ${esc(p.name)}</span>`).join('');
        for (const button of $('dashboardOverview').querySelectorAll('[data-game]')) button.onclick = () => openMatch(button.dataset.game);
    }
    function render() {
        if (!event || event.can_delete !== true) return;
        $('dashboardOverview').hidden = !overview;
        renderOperations();
        renderOverview();
    }
    async function poll() {
        if (!event || event.can_delete !== true || polling || acting) return;
        polling = true;
        const revision = generation;
        try {
            const [state, latest] = await Promise.all([
                rpc('tournament_operation', { p_action: 'state' }),
                rpc('get_t15_result_event', { p_id: event.id })
            ]);
            if (revision !== generation) return;
            if (latest.can_delete !== true) {
                disable();
                return;
            }
            if (latest.version >= event.version) event = latest;
            tables = state.tables;
            connected = true;
        } catch (error) {
            connected = false;
            $('operationMessage').textContent = 'Aktualisierung fehlgeschlagen: ' + error.message;
        } finally {
            polling = false;
            render();
        }
    }
    function disable() {
        clearInterval(timer); timer = null;
        $('tournamentDashboard').hidden = true;
        document.body.classList.remove('tournament-dashboard-page');
        event = null;
    }
    async function action(action) {
        if (acting || !event || event.can_delete !== true) return;
        if (action === 'stop' && !confirm('Tischbetrieb für dieses Turnier beenden? Ergebnisse bleiben erhalten.')) return;
        acting = true; generation++; renderOperations();
        try {
            const state = await rpc('tournament_operation', { p_action: action, p_event: event.id });
            tables = state.tables; connected = true;
            $('operationMessage').textContent = ({start:'Erste Paarungen an die Turniertische verteilt.',pause:'Tischbetrieb pausiert.',resume:'Tischbetrieb fortgesetzt.',stop:'Tischbetrieb beendet. Ergebnisse bleiben erhalten.'})[action];
        } catch (error) {
            $('operationMessage').textContent = error.message;
        } finally {
            acting = false; render();
        }
    }
    for (const [id, command] of [['operationStart','start'],['operationPause','pause'],['operationResume','resume'],['operationStop','stop']]) {
        $(id).onclick = () => action(command);
    }
    window.TournamentDashboard = {
        current() { return event; },
        update(next, view) {
            if (next.can_delete !== true) { disable(); return; }
            if (!event || event.id !== next.id || next.version >= event.version) event = next;
            overview = view === 'overview';
            document.body.classList.add('tournament-dashboard-page');
            $('tournamentDashboard').hidden = false;
            document.title = next.title + ' · Displaybetrieb';
            render();
            if (!timer) { timer = setInterval(poll, 5000); poll(); }
        }
    };
})();
