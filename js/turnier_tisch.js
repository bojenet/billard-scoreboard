/* Tournament-only scoring. Never reads or writes the original app's matches. */
(async () => {
    'use strict';
    const table = new URLSearchParams(location.search).get('tisch');
    const validTables = ['tb01', 'tb02', 'tb03', 'tb04', 'mb01', 'mb02'];
    const el = id => document.getElementById(id);
    const text = (id, value) => { el(id).textContent = value; };
    let device, event, reading = false, writing = false, connected = false, generation = 0, readyAt = 0, transitionTimer;
    const rpc = async (name, args) => {
        const { data, error } = await supabaseClient.rpc(name, args);
        if (error) throw error;
        return data;
    };
    function wait(message, title = '') {
        el('waiting').hidden = false;
        text('message', message);text('waiting-title', title);
        el('table-input').hidden = true;
    }
    if (!validTables.includes(table)) { wait('Ungültiger Tisch. Erlaubt: ' + validTables.join(', ')); return; }
    text('table-name', table.toUpperCase());text('gameTime', table.toUpperCase());
    if (!await requireAdmin()) return;
    const playerName = side => device.assignment.snapshot.participants.find(p => Number(p.seed) === Number(device.assignment['seed' + side]))?.name || 'Spieler';
    function adopt(next, nextEvent) {
        const changed = next.assignment?.key !== device?.assignment?.key || next.event_id !== device?.event_id;
        if (changed) {
            el('input-winner').value = '0';text('input-error', '');clearTimeout(transitionTimer);
            readyAt = device && next.assignment ? Date.now() + 3000 : 0;
            if (readyAt) transitionTimer = setTimeout(() => { if (connected) render(); }, 3100);
        }
        device = next;event = nextEvent;connected = true;
    }
    function render() {
        const a = device?.assignment;
        if (!a || !device.event_id) {
            if (device?.completion || event?.status === 'completed') wait('Turnier beendet', device?.completion?.title || event?.title || '');
            else if (device?.paused) wait('Turnier pausiert');
            else wait(device?.event_id ? 'Wartet auf die nächste spielbereite Partie' : 'Bereit · Warte auf Turnierstart');
            return;
        }
        const snapshot = a.snapshot, result = event.results?.[a.key], s = result || device.live_state || {};
        const saved = !!result || !!s.saved, done = !!s.done, active = Number(s.active || 1);
        const changing = Date.now() < readyAt;
        const disabled = changing || writing || !connected || device.paused || saved || event.status === 'completed';
        for (const side of [1, 2]) {
            text('player' + side + 'Name', playerName(side));text('player' + side + 'Info', 'Ziel ' + snapshot.playingTargetPoints);
            text('score' + side, s['score' + side] ?? 0);
            const innings = Number(s['innings' + side] ?? 0), score = Number(s['score' + side] ?? 0);
            text('inn' + side + 'Display', innings);
            text('hs' + side, Math.max(Number(s['high' + side] || 0), Number(s['series' + side] || 0)));
            text('avg' + side, innings ? (score / innings).toFixed(3).replace('.', ',') : '0,000');
            text('discipline' + side + 'Big', snapshot.discipline || '');
            el('p' + side).className = 'player ' + (active === side && !saved ? 'active-' : 'inactive-') + (side === 1 ? 'white' : 'yellow');
        }
        text('totalInnings', saved || done ? Math.max(Number(s.innings1 || 0), Number(s.innings2 || 0)) : Number(s.innings2 || 0) + 1);
        text('currentSeries', !saved && !done && Number(s['series' + active] || 0) ? '+' + s['series' + active] : '');
        text('disciplineInfo', 'Max. ' + snapshot.playingTargetInnings + ' Aufnahmen');
        const reply = !saved && !done && active === 2 && (Number(s.score1 || 0) >= Number(snapshot.playingTargetPoints) || Number(s.innings1 || 0) >= Number(snapshot.playingTargetInnings));
        el('nachstossLabel').style.display = reply ? 'block' : 'none';
        text('input-active', changing ? 'Nächste Partie · Gleich geht es weiter' : device.paused ? 'Turnier pausiert' : saved ? 'Ergebnis gespeichert · Korrekturen über die Turnierleitung' : done ? 'Partie beendet' : playerName(active) + ' am Spiel' + (reply ? ' · Nachstoß' : ''));
        const remaining = Number(snapshot.playingTargetPoints) - Number(s['score' + active] || 0);
        for (const button of document.querySelectorAll('[data-points]')) {
            const delta = Number(button.dataset.points);
            button.disabled = disabled || done || delta > remaining || (delta < 0 && Number(s['series' + active] || 0) < -delta);
        }
        el('input-turn').disabled = disabled || done;text('input-turn', 'Aufnahme beenden → ' + (active === 1 ? 'Gelb' : 'Weiß'));
        el('input-undo').disabled = disabled || !device.can_undo;
        el('input-completion').hidden = saved || !done;
        text('input-completion-message', a.stage === 'final' && s.score1 === s.score2 ? 'Gleichstand – Sieger nach Entscheid auswählen.' : 'Ergebnis wird automatisch gespeichert.');
        el('input-winner-label').hidden = !(done && a.stage === 'final' && s.score1 === s.score2);
        el('input-winner').disabled = disabled;
        el('input-finish').disabled = disabled;
        document.title = table.toUpperCase() + ' · ' + a.title;
        el('waiting').hidden = true;el('table-input').hidden = false;
    }
    async function refresh() {
        if (reading || writing) return;
        reading = true;const revision = generation;
        try {
            const next = await rpc('tournament_operation', { p_action: 'heartbeat', p_table: table });
            const nextEvent = next.event_id ? await rpc('get_t15_result_event', { p_id: next.event_id }) : null;
            if (revision !== generation) return;
            adopt(next, nextEvent);render();
        } catch (error) {
            if (revision === generation) { connected = false;wait('Verbindung unterbrochen · erneuter Versuch …', error.message); }
        } finally { reading = false; }
    }
    async function input(action, value = 0) {
        if (writing || Date.now() < readyAt || !connected || !device?.assignment || device.paused) return;
        writing = true;generation++;text('input-error', '');render();
        try {
            const next = await rpc('tournament_table_input', { p_table: table, p_event: device.event_id, p_key: device.assignment.key, p_version: device.live_version || 0, p_action: action, p_value: value });
            const changed = next.assignment?.key !== device.assignment?.key || next.event_id !== device.event_id;
            const nextEvent = next.event_id ? (changed || action === 'finish' ? await rpc('get_t15_result_event', { p_id: next.event_id }) : event) : null;
            adopt(next, nextEvent);
        } catch (error) {
            connected = false;
            text('input-error', error.message + ' · Der aktuelle Stand wird neu geladen.');
        } finally { writing = false;render();if (!connected) await refresh(); }
    }
    for (const button of document.querySelectorAll('[data-points]')) button.onclick = () => input('points', Number(button.dataset.points));
    el('input-turn').onclick = () => input('turn');el('input-undo').onclick = () => input('undo');
    el('input-finish').onclick = () => input('finish', Number(el('input-winner').value));
    await refresh();setInterval(refresh, 3000);
})();
